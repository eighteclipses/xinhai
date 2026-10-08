package com.xinhai.study;

import android.content.Context;
import android.database.Cursor;
import android.database.sqlite.SQLiteDatabase;
import android.net.Uri;
import android.os.Build;
import android.os.SystemClock;
import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyProperties;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.InetAddress;
import java.net.URI;
import java.net.URISyntaxException;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.security.GeneralSecurityException;
import java.security.KeyStore;
import java.security.MessageDigest;
import java.security.SecureRandom;
import java.util.Arrays;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.Locale;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.Executors;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.ScheduledFuture;
import java.util.regex.Pattern;

import javax.crypto.Cipher;
import javax.crypto.KeyGenerator;
import javax.crypto.SecretKey;
import javax.crypto.spec.GCMParameterSpec;

/**
 * Android-only model configuration and transport boundary.
 *
 * The renderer receives status and model replies, never the API key. The key
 * is stored only inside an AndroidKeyStore-backed AES/GCM vault and is added
 * to Authorization immediately before the native request is sent.
 */
final class ModelService {
    static final String DEFAULT_ENDPOINT = "https://api.deepseek.com/chat/completions";
    static final String DEFAULT_MODEL = "deepseek-chat";
    static final int MAX_REQUEST_BYTES = 128 * 1024;
    static final long MAX_REPLY_BYTES = 4L * 1024L * 1024L;
    static final long REQUEST_TIMEOUT_MS = 30_000L;
    private static final String KEYSTORE = "AndroidKeyStore";
    private static final String DEFAULT_ALIAS = "xinhai.model.v1";
    private static final byte[] MAGIC = "XINHAI-MODEL-V1".getBytes(StandardCharsets.US_ASCII);
    private static final int IV_BYTES = 12;
    private static final Pattern CONTROL = Pattern.compile("[\\u0000-\\u001f\\u007f]");
    private static final Pattern PORT = Pattern.compile("[0-9]{1,5}");
    private static final Set<String> LOOPBACK = new HashSet<>(Arrays.asList("localhost", "127.0.0.1", "[::1]", "::1"));
    private static final ScheduledExecutorService DEADLINE_EXECUTOR = Executors.newSingleThreadScheduledExecutor(r -> {
        Thread thread = new Thread(r, "xinhai-model-deadline");
        thread.setDaemon(true);
        return thread;
    });

    private final Context context;
    private final SQLiteDatabase database;
    private final String alias;
    private final File vaultFile;
    private final long requestTimeoutMs;
    private final Object lock = new Object();

    ModelService(Context source, SQLiteDatabase database) {
        this(source, database, DEFAULT_ALIAS, new File(source.getFilesDir(), "model-config.enc"), REQUEST_TIMEOUT_MS);
    }

    /** Package-private fixture constructor: tests use an isolated alias and vault file. */
    ModelService(Context source, SQLiteDatabase database, String alias, File vaultFile) {
        this(source, database, alias, vaultFile, REQUEST_TIMEOUT_MS);
    }

    /** Package-private timeout constructor for a deterministic slow-stream fixture. */
    ModelService(Context source, SQLiteDatabase database, String alias, File vaultFile, long requestTimeoutMs) {
        Context app = source.getApplicationContext();
        context = app == null ? source : app;
        this.database = database;
        this.alias = alias;
        this.vaultFile = vaultFile;
        if (requestTimeoutMs <= 0) throw new IllegalArgumentException("模型请求超时时间无效");
        this.requestTimeoutMs = requestTimeoutMs;
    }

    JSONObject status() {
        synchronized (lock) {
            try {
                Config config = loadConfig(true);
                boolean configured = config.key != null && !config.key.isEmpty();
                return status(config.endpoint, config.model, configured, keystoreAvailable(), configured ? "模型配置已就绪" : "尚未配置模型密钥");
            } catch (Exception error) {
                return status(publicEndpoint(), publicModel(), false, keystoreAvailable(), safeMessage(error));
            }
        }
    }

    JSONObject save(JSONObject input) throws Exception {
        requireModelAnalysis();
        synchronized (lock) {
            SaveInput value = validateSave(input);
            Config old = loadConfig(true);
            boolean hasKey = input.has("key");
            String nextKey;
            if (!hasKey) {
                if (old.key == null || old.key.isEmpty()) nextKey = "";
                else if (!old.endpoint.equals(value.endpoint)) throw new IOException("更换 API 地址需要重新输入密钥");
                else nextKey = old.key;
            } else if (input.isNull("key")) {
                nextKey = "";
            } else {
                nextKey = input.getString("key");
                validateKey(nextKey);
            }
            Config next = new Config(value.endpoint, value.model, nextKey);
            persist(next);
            updatePublicSettings(next.endpoint, next.model, true);
            return status(next.endpoint, next.model, !next.key.isEmpty(), keystoreAvailable(), next.key.isEmpty() ? "配置已保存，但尚未配置密钥" : "模型配置已保存");
        }
    }

    JSONObject clear() throws Exception {
        synchronized (lock) {
            // Clearing public fields first never removes the only encrypted key
            // if the vault deletion itself fails. A retry can finish the clear.
            updatePublicSettings(DEFAULT_ENDPOINT, DEFAULT_MODEL, true);
            if (vaultFile.exists() && !vaultFile.delete()) throw new IOException("无法删除加密模型配置，请重试");
            return status(DEFAULT_ENDPOINT, DEFAULT_MODEL, false, keystoreAvailable(), "模型配置已清除");
        }
    }

    JSONObject request(JSONObject input) throws Exception {
        requireModelAnalysis();
        synchronized (lock) {
            Config config = loadConfig(true);
            if (config.key == null || config.key.isEmpty()) throw new IOException("尚未配置模型密钥");
            RequestValue request = validateRequest(input);
            return send(config, request);
        }
    }

    private static void requireModelAnalysis() throws IOException {
        if (BuildConfig.COMMERCIAL_EDITION) throw new IOException("本版本仅提供本地分析，云模型接入已关闭。");
    }

    private JSONObject send(Config config, RequestValue request) throws Exception {
        byte[] body = requestBody(config.model, request);
        if (body.length > MAX_REQUEST_BYTES) throw new IOException("模型请求内容过长");
        long deadline = SystemClock.elapsedRealtime() + requestTimeoutMs;
        URL url = new URL(config.endpoint);
        HttpURLConnection connection = (HttpURLConnection) url.openConnection();
        ScheduledFuture<?> deadlineTask = DEADLINE_EXECUTOR.schedule(connection::disconnect, requestTimeoutMs, java.util.concurrent.TimeUnit.MILLISECONDS);
        try {
            connection.setInstanceFollowRedirects(false);
            int remaining = remainingTimeout(deadline);
            connection.setConnectTimeout(remaining);
            connection.setReadTimeout(remaining);
            connection.setRequestMethod("POST");
            connection.setDoOutput(true);
            connection.setRequestProperty("Content-Type", "application/json");
            connection.setRequestProperty("Accept", "application/json");
            connection.setRequestProperty("Authorization", "Bearer " + config.key);
            connection.setFixedLengthStreamingMode(body.length);
            try (OutputStream output = connection.getOutputStream()) { output.write(body); }
            connection.setReadTimeout(remainingTimeout(deadline));
            int status = connection.getResponseCode();
            if (status >= 300 && status < 400) return new JSONObject().put("status", status).put("body", "");
            InputStream stream = status >= 400 ? connection.getErrorStream() : connection.getInputStream();
            if (stream == null) return new JSONObject().put("status", status).put("body", "");
            if (status < 200 || status >= 300) {
                closeQuietly(stream);
                return new JSONObject().put("status", status).put("body", "");
            }
            connection.setReadTimeout(remainingTimeout(deadline));
            byte[] response = readBounded(stream, MAX_REPLY_BYTES, deadline);
            return new JSONObject().put("status", status).put("body", new String(response, StandardCharsets.UTF_8));
        } catch (java.net.SocketTimeoutException socketTimeout) {
            throw new IOException("模型请求超时，请稍后重试");
        } catch (IOException networkFailure) {
            if (SystemClock.elapsedRealtime() >= deadline) throw new IOException("模型请求超时，请稍后重试");
            throw networkFailure;
        } finally {
            deadlineTask.cancel(false);
            connection.disconnect();
        }
    }

    private Config loadConfig(boolean migrateLegacy) throws Exception {
        if (vaultFile.exists()) {
            // A readable vault is authoritative.  If an interrupted upgrade
            // left the old settings key behind, retry clearing only that
            // public copy; never replace the vault with the legacy value.
            Config stored = decrypt(readAll(vaultFile, 128 * 1024));
            clearLegacyIfPresent(stored);
            return stored;
        }
        Legacy legacy = readLegacy();
        if (legacy.key.isEmpty()) { Config empty = new Config(legacy.endpoint, legacy.model, ""); clearLegacyIfPresent(empty); return empty; }
        if (!migrateLegacy) return new Config(legacy.endpoint, legacy.model, "");
        // The old key is never returned to the renderer. It is either migrated
        // into a validated vault or retained in settings for a later retry.
        Config migrated = new Config(legacy.endpoint, legacy.model, legacy.key);
        try {
            persist(migrated);
            updatePublicSettings(migrated.endpoint, migrated.model, true);
            return migrated;
        } catch (Exception migrationFailure) {
            // persist() has already verified and atomically committed the
            // vault before public settings are cleared. Keep that vault when
            // the second step fails; the next status/request retries cleanup
            // without losing the only encrypted copy.
            throw new IOException("模型密钥迁移未完成，请稍后重试", migrationFailure);
        }
    }

    private Legacy readLegacy() throws Exception {
        String endpoint = DEFAULT_ENDPOINT, model = DEFAULT_MODEL, key = "";
        try (Cursor cursor = database.rawQuery("SELECT json FROM settings WHERE id=1", null)) {
            if (cursor.moveToFirst()) {
                JSONObject settings = new JSONObject(cursor.getString(0));
                endpoint = normalizeEndpoint(settings.optString("llmEndpoint", ""));
                model = normalizeModel(settings.optString("llmModel", DEFAULT_MODEL));
                key = settings.optString("llmKey", "").trim();
                if (!key.isEmpty()) validateKey(key);
            }
        } catch (android.database.sqlite.SQLiteException queryFailure) {
            // Only an actually absent table is a normal first-launch state.
            // Trigger, lock, corruption, and other SQLite failures must abort
            // migration instead of silently losing the legacy key.
            if (settingsTableExists()) throw queryFailure;
        }
        return new Legacy(endpoint, model, key);
    }

    private void updatePublicSettings(String endpoint, String model, boolean clearKey) throws Exception {
        try (Cursor cursor = database.rawQuery("SELECT json FROM settings WHERE id=1", null)) {
            if (!cursor.moveToFirst()) return;
            JSONObject settings = new JSONObject(cursor.getString(0));
            settings.put("llmEndpoint", endpoint);
            settings.put("llmModel", model);
            if (clearKey) settings.put("llmKey", "");
            android.content.ContentValues values = new android.content.ContentValues();
            values.put("json", settings.toString());
            if (database.update("settings", values, "id=1", null) != 1) throw new IOException("模型公共配置保存失败");
        } catch (android.database.sqlite.SQLiteException queryFailure) {
            if (settingsTableExists()) throw queryFailure;
            // Before settings exists, there is no legacy key to clear.
        }
    }

    private void clearLegacyIfPresent(Config stored) throws Exception {
        boolean hasLegacy = false;
        try (Cursor cursor = database.rawQuery("SELECT json FROM settings WHERE id=1", null)) {
            if (!cursor.moveToFirst()) return;
            JSONObject settings = new JSONObject(cursor.getString(0));
            hasLegacy = !settings.optString("llmKey", "").isEmpty();
        } catch (android.database.sqlite.SQLiteException queryFailure) {
            if (settingsTableExists()) throw queryFailure;
            // First launch may not have the JS-created settings table yet.
        }
        if (hasLegacy) {
            // Keep every unrelated public setting while replacing the legacy
            // endpoint/model with the already-validated vault copy.
            updatePublicSettings(stored.endpoint, stored.model, true);
        }
    }

    private boolean settingsTableExists() throws Exception {
        try (Cursor cursor = database.rawQuery("SELECT 1 FROM sqlite_master WHERE type='table' AND name='settings'", null)) {
            return cursor.moveToFirst();
        }
    }

    private void persist(Config config) throws Exception {
        SecretKey key = keyForEncryption();
        Encrypted encryptedValue = encrypt(key, configJson(config).getBytes(StandardCharsets.UTF_8));
        ByteArrayOutputStream encoded = new ByteArrayOutputStream();
        encoded.write(MAGIC);
        encoded.write(encryptedValue.iv);
        encoded.write(encryptedValue.payload);
        File parent = vaultFile.getParentFile();
        if (parent != null && !parent.exists() && !parent.mkdirs()) throw new IOException("无法创建模型配置目录");
        File temporary = new File(vaultFile.getParentFile(), vaultFile.getName() + "." + UUID.randomUUID() + ".part");
        try {
            try (FileOutputStream output = new FileOutputStream(temporary)) {
                output.write(encoded.toByteArray());
                output.getFD().sync();
            }
            // Verify the exact bytes before the atomic rename.
            decrypt(readAll(temporary, 128 * 1024));
            if (!temporary.renameTo(vaultFile)) throw new IOException("模型配置原子提交失败");
        } finally {
            deleteQuietly(temporary);
        }
    }

    private Config decrypt(byte[] encoded) throws Exception {
        if (encoded.length <= MAGIC.length + IV_BYTES || !startsWith(encoded, MAGIC)) throw new IOException("模型加密配置损坏");
        byte[] iv = Arrays.copyOfRange(encoded, MAGIC.length, MAGIC.length + IV_BYTES);
        byte[] encrypted = Arrays.copyOfRange(encoded, MAGIC.length + IV_BYTES, encoded.length);
        SecretKey key = keyForDecryption();
        JSONObject value;
        try { value = new JSONObject(new String(crypt(Cipher.DECRYPT_MODE, key, iv, encrypted), StandardCharsets.UTF_8)); }
        catch (Exception error) { throw new IOException("模型加密配置无法解密", error); }
        String endpoint = normalizeEndpoint(value.optString("endpoint", ""));
        String model = normalizeModel(value.optString("model", DEFAULT_MODEL));
        String secret = value.optString("key", "");
        if (!secret.isEmpty()) validateKey(secret);
        return new Config(endpoint, model, secret);
    }

    private SecretKey keyForEncryption() throws Exception {
        KeyStore store = keyStore();
        if (store.containsAlias(alias)) return (SecretKey) store.getKey(alias, null);
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.M) throw new IOException("AndroidKeyStore 不可用");
        KeyGenerator generator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, KEYSTORE);
        generator.init(new KeyGenParameterSpec.Builder(alias, KeyProperties.PURPOSE_ENCRYPT | KeyProperties.PURPOSE_DECRYPT)
                .setKeySize(256).setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE).setRandomizedEncryptionRequired(true).build());
        return generator.generateKey();
    }

    private SecretKey keyForDecryption() throws Exception {
        KeyStore store = keyStore();
        if (!store.containsAlias(alias)) throw new IOException("AndroidKeyStore 密钥缺失");
        return (SecretKey) store.getKey(alias, null);
    }

    private KeyStore keyStore() throws Exception {
        KeyStore store = KeyStore.getInstance(KEYSTORE);
        store.load(null);
        return store;
    }

    private boolean keystoreAvailable() {
        try { keyStore(); return true; } catch (Exception ignored) { return false; }
    }

    private Encrypted encrypt(SecretKey key, byte[] data) throws Exception {
        Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
        // AndroidKeyStore keys marked randomizedEncryptionRequired reject a
        // caller-provided GCM IV. Let the provider create the random IV and
        // persist the exact IV returned by the cipher with the ciphertext.
        cipher.init(Cipher.ENCRYPT_MODE, key);
        byte[] iv = cipher.getIV();
        if (iv == null || iv.length != IV_BYTES) throw new IOException("AndroidKeyStore 随机 IV 无效");
        return new Encrypted(iv, cipher.doFinal(data));
    }

    private byte[] crypt(int mode, SecretKey key, byte[] iv, byte[] data) throws Exception {
        Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
        cipher.init(mode, key, new GCMParameterSpec(128, iv));
        return cipher.doFinal(data);
    }

    private static JSONObject status(String endpoint, String model, boolean configured, boolean available, String message) {
        try { return new JSONObject().put("endpoint", endpoint).put("model", model).put("configured", configured).put("available", available).put("message", message); }
        catch (Exception error) { return new JSONObject(); }
    }

    private String publicEndpoint() { try { return readLegacy().endpoint; } catch (Exception ignored) { return DEFAULT_ENDPOINT; } }
    private String publicModel() { try { return readLegacy().model; } catch (Exception ignored) { return DEFAULT_MODEL; } }
    static String safeMessage(Exception error) {
        Throwable current = error;
        while (current != null) {
            if (current instanceof java.net.SocketTimeoutException) return "模型请求超时，请稍后重试";
            String message = current.getMessage();
            if (message != null) {
                switch (message) {
                    case "本版本仅提供本地分析，云模型接入已关闭。":
                    case "更换 API 地址需要重新输入密钥":
                    case "无法删除加密模型配置，请重试":
                    case "尚未配置模型密钥":
                    case "模型请求内容过长":
                    case "模型请求超时，请稍后重试":
                    case "模型配置字段无效":
                    case "模型请求无效":
                    case "模型请求消息无效":
                    case "模型请求角色无效":
                    case "模型请求正文过长":
                    case "模型 token 数无效":
                    case "API 地址无效":
                    case "API 端口无效":
                    case "外部模型服务必须使用 HTTPS":
                    case "API 路径无效":
                    case "模型名称无效":
                    case "密钥不能为空或包含空白字符":
                    case "模型内容过大":
                    case "模型配置损坏":
                    case "模型加密配置损坏":
                    case "模型加密配置无法解密":
                    case "AndroidKeyStore 密钥缺失":
                    case "AndroidKeyStore 不可用":
                    case "AndroidKeyStore 随机 IV 无效":
                    case "模型密钥迁移未完成，请稍后重试":
                    case "模型公共配置保存失败":
                    case "模型配置原子提交失败":
                    case "模型配置目录创建失败":
                    case "无法创建模型配置目录":
                        return message;
                    default:
                        break;
                }
            }
            current = current.getCause();
        }
        return "模型加密配置不可用";
    }

    private static SaveInput validateSave(JSONObject input) throws Exception {
        if (input == null || fieldCount(input) < 2 || fieldCount(input) > 3 || !hasOnly(input, "endpoint", "model", "key") || !(input.opt("endpoint") instanceof String) || !(input.opt("model") instanceof String) || (input.has("key") && !input.isNull("key") && !(input.opt("key") instanceof String))) throw new IOException("模型配置字段无效");
        String endpoint = normalizeEndpoint(input.getString("endpoint"));
        String model = normalizeModel(input.getString("model"));
        if (input.has("key") && !input.isNull("key")) validateKey(input.getString("key"));
        return new SaveInput(endpoint, model);
    }

    private static RequestValue validateRequest(JSONObject input) throws Exception {
        if (input == null || fieldCount(input) != 3 || !hasOnly(input, "messages", "json", "maxTokens") || !(input.opt("messages") instanceof JSONArray) || !(input.opt("json") instanceof Boolean) || !(input.opt("maxTokens") instanceof Number)) throw new IOException("模型请求无效");
        JSONArray messages = input.getJSONArray("messages");
        if (messages.length() < 1 || messages.length() > 2) throw new IOException("模型请求消息无效");
        ArrayList<Message> result = new ArrayList<>();
        for (int i = 0; i < messages.length(); i++) {
            JSONObject message = messages.getJSONObject(i);
            if (fieldCount(message) != 2 || !hasOnly(message, "role", "content") || !(message.opt("role") instanceof String) || !(message.opt("content") instanceof String)) throw new IOException("模型请求消息无效");
            String role = message.getString("role");
            if (!("system".equals(role) || "user".equals(role))) throw new IOException("模型请求角色无效");
            String content = message.getString("content");
            if (content.length() > 30_000) throw new IOException("模型请求正文过长");
            result.add(new Message(role, content));
        }
        long maxTokens = ((Number) input.get("maxTokens")).longValue();
        if (maxTokens < 1 || maxTokens > 2048 || ((Number) input.get("maxTokens")).doubleValue() != maxTokens) throw new IOException("模型 token 数无效");
        return new RequestValue(result, input.getBoolean("json"), (int) maxTokens);
    }

    private static byte[] requestBody(String model, RequestValue request) throws Exception {
        JSONObject body = new JSONObject().put("model", model).put("messages", new JSONArray());
        JSONArray messages = body.getJSONArray("messages");
        for (Message message : request.messages) messages.put(new JSONObject().put("role", message.role).put("content", message.content));
        body.put("max_tokens", request.maxTokens);
        if (request.json) body.put("response_format", new JSONObject().put("type", "json_object"));
        return body.toString().getBytes(StandardCharsets.UTF_8);
    }

    static String normalizeEndpoint(String raw) throws IOException {
        String value = raw == null ? "" : raw.trim();
        if (value.isEmpty()) return DEFAULT_ENDPOINT;
        if (value.length() > 2048 || CONTROL.matcher(value).find() || value.contains("\\") || value.contains("?") || value.contains("#")) throw new IOException("API 地址无效");
        URI uri;
        try { uri = new URI(value); } catch (URISyntaxException error) { throw new IOException("API 地址无效", error); }
        String scheme = uri.getScheme();
        if (!("https".equalsIgnoreCase(scheme) || "http".equalsIgnoreCase(scheme)) || uri.getUserInfo() != null || uri.getHost() == null || uri.getRawAuthority() == null) throw new IOException("API 地址无效");
        String authority = uri.getRawAuthority();
        if (authority.contains("@") || authority.contains("/") || authority.matches(".*\\s.*") || authority.toLowerCase(Locale.ROOT).startsWith("localhost.")) throw new IOException("API 地址无效");
        if (uri.getPort() > 65535) throw new IOException("API 端口无效");
        String host = uri.getHost().toLowerCase(Locale.ROOT);
        boolean loopback = LOOPBACK.contains(host) || "[::1]".equalsIgnoreCase(host);
        if ("http".equalsIgnoreCase(scheme) && !loopback) throw new IOException("外部模型服务必须使用 HTTPS");
        if ("localhost".equals(host)) host = "127.0.0.1";
        String path = uri.getRawPath() == null ? "" : uri.getRawPath();
        if (path.contains("//")) throw new IOException("API 路径无效");
        while (path.endsWith("/") && !path.isEmpty()) path = path.substring(0, path.length() - 1);
        if (!path.endsWith("/chat/completions")) path += "/chat/completions";
        String port = uri.getPort() < 0 ? "" : ":" + uri.getPort();
        String authorityOut = host.contains(":") ? "[" + host.replace("[", "").replace("]", "") + "]" + port : host + port;
        return scheme.toLowerCase(Locale.ROOT) + "://" + authorityOut + path;
    }

    private static String normalizeModel(String value) throws IOException {
        String model = value == null ? DEFAULT_MODEL : value.trim();
        if (model.isEmpty()) model = DEFAULT_MODEL;
        if (model.length() > 200 || CONTROL.matcher(model).find()) throw new IOException("模型名称无效");
        return model;
    }

    private static void validateKey(String key) throws IOException {
        if (key == null || key.trim().isEmpty() || key.length() > 8192 || Pattern.compile("[\\u0000-\\u0020\\u007f]").matcher(key).find()) throw new IOException("密钥不能为空或包含空白字符");
    }

    private static String configJson(Config config) throws Exception { return new JSONObject().put("endpoint", config.endpoint).put("model", config.model).put("key", config.key).toString(); }
    private static int fieldCount(JSONObject value) { int count = 0; for (java.util.Iterator<String> it = value.keys(); it.hasNext(); ) { it.next(); count++; } return count; }
    private static boolean hasOnly(JSONObject value, String... names) { Set<String> allowed = new HashSet<>(Arrays.asList(names)); for (java.util.Iterator<String> it = value.keys(); it.hasNext(); ) if (!allowed.contains(it.next())) return false; return true; }
    private static int remainingTimeout(long deadline) throws java.net.SocketTimeoutException {
        long remaining = deadline - SystemClock.elapsedRealtime();
        if (remaining <= 0) throw new java.net.SocketTimeoutException("模型请求超时");
        return (int) Math.min(Integer.MAX_VALUE, remaining);
    }
    private static byte[] readAll(File file, long limit) throws IOException { try (InputStream input = new FileInputStream(file)) { return readBounded(input, limit); } }
    private static byte[] readBounded(InputStream input, long limit) throws IOException { return readBounded(input, limit, Long.MAX_VALUE); }
    private static byte[] readBounded(InputStream input, long limit, long deadline) throws IOException { try (InputStream in = input; ByteArrayOutputStream out = new ByteArrayOutputStream()) { byte[] buffer = new byte[16 * 1024]; long total = 0; int count; while (true) { if (deadline != Long.MAX_VALUE) remainingTimeout(deadline); count = in.read(buffer); if (count == -1) break; total += count; if (total > limit) throw new IOException("模型内容过大"); out.write(buffer, 0, count); } return out.toByteArray(); } }
    private static boolean startsWith(byte[] bytes, byte[] prefix) { return bytes.length >= prefix.length && Arrays.equals(prefix, Arrays.copyOf(bytes, prefix.length)); }
    private static void closeQuietly(InputStream input) { try { input.close(); } catch (Exception ignored) {} }
    private static void deleteQuietly(File file) { if (file != null && file.exists()) file.delete(); }

    private static final class Encrypted { final byte[] iv, payload; Encrypted(byte[] iv, byte[] payload) { this.iv = iv; this.payload = payload; } }
    private static final class Legacy { final String endpoint, model, key; Legacy(String endpoint, String model, String key) { this.endpoint = endpoint; this.model = model; this.key = key; } }
    private static final class Config { final String endpoint, model, key; Config(String endpoint, String model, String key) { this.endpoint = endpoint; this.model = model; this.key = key; } }
    private static final class SaveInput { final String endpoint, model; SaveInput(String endpoint, String model) { this.endpoint = endpoint; this.model = model; } }
    private static final class Message { final String role, content; Message(String role, String content) { this.role = role; this.content = content; } }
    private static final class RequestValue { final ArrayList<Message> messages; final boolean json; final int maxTokens; RequestValue(ArrayList<Message> messages, boolean json, int maxTokens) { this.messages = messages; this.json = json; this.maxTokens = maxTokens; } }
}
