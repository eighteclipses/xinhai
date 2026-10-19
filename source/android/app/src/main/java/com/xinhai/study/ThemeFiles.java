package com.xinhai.study;

import android.content.ContentResolver;
import android.content.Context;
import android.graphics.BitmapFactory;
import android.net.Uri;
import android.provider.OpenableColumns;

import org.json.JSONException;
import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.FilterOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;
import java.nio.charset.CharacterCodingException;
import java.nio.charset.CodingErrorAction;
import java.security.MessageDigest;
import java.util.Arrays;
import java.util.HashSet;
import java.util.Iterator;
import java.util.Locale;
import java.util.Set;
import java.util.UUID;
import java.util.zip.ZipEntry;
import java.util.zip.ZipException;
import java.util.zip.ZipInputStream;
import java.util.zip.ZipOutputStream;

/**
 * Private, streaming file handling for shareable Android themes.
 *
 * This class intentionally accepts only content URIs for imports and only the
 * app's own files directory for exports.  A theme never gets an arbitrary
 * local path or a user database value through this boundary.
 */
final class ThemeFiles {
    static final String ORIGIN = "https://" + MainActivity.HOST;
    private static final long KIB = 1024L;
    private static final long MIB = KIB * KIB;
    static final long MAX_ZIP_BYTES = 301L * MIB;
    static final long MAX_THEME_JSON_BYTES = 64L * KIB;
    static final long MAX_IMAGE_BYTES = 30L * MIB;
    static final long MAX_VIDEO_BYTES = 300L * MIB;
    private static final long MAX_IMAGE_PIXELS = 100_000_000L;

    private static final Set<String> BUILTIN_IDS = new HashSet<>(Arrays.asList(
            "original-deep-sea", "original-forest-dawn", "original-orbital-night"));
    private static final Set<String> IMAGE_EXTENSIONS = new HashSet<>(Arrays.asList(
            "png", "jpg", "jpeg", "webp"));
    private static final Set<String> VIDEO_EXTENSIONS = new HashSet<>(Arrays.asList(
            "mp4", "webm"));
    private static final Set<String> TOP_LEVEL_FIELDS = new HashSet<>(Arrays.asList(
            "format", "version", "name", "appearance", "wallpaper"));
    private static final Set<String> BUILTIN_FIELDS = new HashSet<>(Arrays.asList("type", "id"));
    private static final Set<String> EMBEDDED_FIELDS = new HashSet<>(Arrays.asList(
            "type", "file", "name", "kind"));

    private final ContentResolver resolver;
    private final File backgrounds;
    private final android.content.SharedPreferences receiptPreferences;

    ThemeFiles(Context context) {
        Context appContext = context.getApplicationContext();
        this.resolver = appContext.getContentResolver();
        this.backgrounds = new File(appContext.getFilesDir(), "backgrounds");
        this.receiptPreferences = appContext.getSharedPreferences("xinhai-theme-files", Context.MODE_PRIVATE);
    }

    /** Import a .zip/.xinhai-theme from a user-selected content URI. */
    JSONObject importTheme(Uri source, String displayName) throws Exception {
        String sourceExtension = extension(displayName);
        if (!("zip".equals(sourceExtension) || "xinhai-theme".equals(sourceExtension))) {
            throw new IOException("主题文件必须是 .zip 或 .xinhai-theme");
        }
        ensureBackgrounds();
        File attachmentPart = null;
        String attachmentName = null;
        byte[] manifestBytes = null;
        long[] uncompressed = {0L};
        try (InputStream raw = resolver.openInputStream(source)) {
            if (raw == null) throw new IOException("无法读取主题文件");
            CountingInputStream counted = new CountingInputStream(raw, MAX_ZIP_BYTES);
            try (ZipInputStream zip = new ZipInputStream(counted)) {
                Set<String> entries = new HashSet<>();
                ZipEntry entry;
                while ((entry = zip.getNextEntry()) != null) {
                    String name = entry.getName();
                    validateEntryName(name);
                    if (!entries.add(name)) throw new IOException("主题 ZIP 含有重复文件");
                    if (entry.isDirectory() || name.endsWith("/")) {
                        throw new IOException("主题 ZIP 不允许目录条目");
                    }
                    if (entry.getMethod() != ZipEntry.STORED && entry.getMethod() != ZipEntry.DEFLATED) {
                        throw new IOException("主题 ZIP 压缩方式不受支持");
                    }
                    if ("theme.json".equals(name)) {
                        long declared = entry.getSize();
                        if (declared > MAX_THEME_JSON_BYTES) throw new IOException("theme.json 超过 64 KiB");
                        manifestBytes = readEntry(zip, MAX_THEME_JSON_BYTES, uncompressed);
                    } else if (isWallpaperEntry(name)) {
                        if (attachmentPart != null) throw new IOException("主题 ZIP 只能包含一个壁纸附件");
                        String ext = extension(name);
                        long limit = VIDEO_EXTENSIONS.contains(ext) ? MAX_VIDEO_BYTES : MAX_IMAGE_BYTES;
                        long declared = entry.getSize();
                        if (declared > limit) throw new IOException("壁纸超过大小限制");
                        attachmentName = name;
                        attachmentPart = new File(backgrounds, "." + UUID.randomUUID() + ".theme.part");
                        try (OutputStream out = new FileOutputStream(attachmentPart)) {
                            copyEntry(zip, out, limit, uncompressed);
                        }
                    } else {
                        throw new IOException("主题 ZIP 含有未知文件: " + name);
                    }
                    zip.closeEntry();
                    if (counted.count > MAX_ZIP_BYTES || uncompressed[0] > MAX_ZIP_BYTES) {
                        throw new IOException("主题 ZIP 超过大小限制");
                    }
                }
                // ZipInputStream stops when it reaches the central directory and
                // may leave comments or trailing bytes unread. Drain the source
                // so the size limit applies to the complete selected file.
                byte[] trailing = new byte[64 * 1024];
                while (counted.read(trailing, 0, trailing.length) != -1) {
                    // CountingInputStream enforces MAX_ZIP_BYTES.
                }
                if (counted.count > MAX_ZIP_BYTES) throw new IOException("主题 ZIP 超过大小限制");
            } catch (ZipException e) {
                // ZipInputStream rejects encrypted entries and malformed central/local
                // headers. Do not expose a partially extracted file to the renderer.
                throw new IOException("主题 ZIP 无效或已加密", e);
            }
        } catch (Exception e) {
            deleteQuietly(attachmentPart);
            throw e;
        }

        if (manifestBytes == null) {
            deleteQuietly(attachmentPart);
            throw new IOException("主题 ZIP 缺少 theme.json");
        }
        JSONObject manifest;
        try {
            String json = StandardCharsets.UTF_8.newDecoder()
                    .onMalformedInput(CodingErrorAction.REPORT)
                    .onUnmappableCharacter(CodingErrorAction.REPORT)
                    .decode(java.nio.ByteBuffer.wrap(manifestBytes)).toString();
            manifest = new JSONObject(json);
        } catch (JSONException | CharacterCodingException e) {
            deleteQuietly(attachmentPart);
            throw new IOException("theme.json 不是有效 JSON", e);
        }
        WallpaperDescriptor descriptor;
        try {
            descriptor = validateManifest(manifest);
            if (descriptor.embedded != (attachmentPart != null)) {
                throw new IOException(descriptor.embedded
                        ? "嵌入式主题缺少壁纸附件"
                        : "内置主题不允许包含壁纸附件");
            }
            if (descriptor.embedded && !descriptor.file.equals(attachmentName)) {
                throw new IOException("theme.json 与壁纸附件不一致");
            }
        } catch (Exception e) {
            deleteQuietly(attachmentPart);
            throw e;
        }

        if (!descriptor.embedded) {
            return new JSONObject().put("manifest", manifest)
                    .put("wallpaper", JSONObject.NULL)
                    .put("receipt", JSONObject.NULL);
        }

        File destination = null;
        try {
            validateMediaFile(attachmentPart, extension(descriptor.file), descriptor.kind);
            String ext = extension(descriptor.file);
            destination = new File(backgrounds, UUID.randomUUID().toString() + "." + ext);
            if (!attachmentPart.renameTo(destination)) throw new IOException("保存主题壁纸失败");
            attachmentPart = null;
            String receipt = UUID.randomUUID().toString();
            rememberReceipt(receipt, destination);
            JSONObject custom = customBackground(descriptor.name, destination, descriptor.kind);
            return new JSONObject().put("manifest", manifest)
                    .put("wallpaper", custom)
                    .put("receipt", receipt);
        } catch (Exception e) {
            deleteQuietly(attachmentPart);
            deleteQuietly(destination);
            throw e;
        }
    }

    /** Import the legacy standalone wallpaper picker format with real media checks. */
    JSONObject importBackground(Uri source, String displayName) throws Exception {
        String ext = extension(displayName);
        String kind = kindForExtension(ext);
        if (kind == null) throw new IOException("文件格式不支持");
        long limit = "video".equals(kind) ? MAX_VIDEO_BYTES : MAX_IMAGE_BYTES;
        ensureBackgrounds();
        File part = new File(backgrounds, "." + UUID.randomUUID() + ".background.part");
        MessageDigest digest = MessageDigest.getInstance("SHA-256");
        long[] total = {0L};
        try {
            try (InputStream in = resolver.openInputStream(source);
                 OutputStream out = new DigestOutputStream(new FileOutputStream(part), digest, limit)) {
                if (in == null) throw new IOException("无法读取文件");
                copy(in, out, limit, total);
            }
            if (total[0] == 0) throw new IOException("文件为空");
            validateMediaFile(part, ext, kind);
            StringBuilder hash = new StringBuilder();
            for (byte b : digest.digest()) hash.append(String.format(Locale.ROOT, "%02x", b & 255));
            File destination = new File(backgrounds, hash + "." + ext);
            if (!destination.exists() && !part.renameTo(destination)) throw new IOException("保存导入文件失败");
            JSONObject custom = customBackground(displayName, destination, kind);
            return custom;
        } finally {
            deleteQuietly(part);
        }
    }

    /** Export a validated manifest and one private local wallpaper into a selected URI. */
    String exportTheme(Uri destination, JSONObject manifest, String wallpaperSrc) throws Exception {
        WallpaperDescriptor descriptor = validateManifest(manifest);
        File source = null;
        if (descriptor.embedded) {
            source = privateWallpaperFile(wallpaperSrc, descriptor.file, descriptor.kind);
        } else if (wallpaperSrc != null && !wallpaperSrc.isEmpty()) {
            // Built-in themes never need a local file. Refuse a surprising extra
            // path instead of silently exporting arbitrary content.
            throw new IOException("内置主题不允许携带本地壁纸");
        }
        byte[] manifestBytes = manifest.toString().getBytes(StandardCharsets.UTF_8);
        if (manifestBytes.length > MAX_THEME_JSON_BYTES) throw new IOException("theme.json 超过 64 KiB");
        try (OutputStream raw = resolver.openOutputStream(destination, "wt")) {
            if (raw == null) throw new IOException("无法写入主题文件");
            CountingOutputStream counted = new CountingOutputStream(raw, MAX_ZIP_BYTES);
            try (ZipOutputStream zip = new ZipOutputStream(counted)) {
                ZipEntry manifestEntry = new ZipEntry("theme.json");
                manifestEntry.setTime(0L);
                zip.putNextEntry(manifestEntry);
                zip.write(manifestBytes);
                zip.closeEntry();
                if (descriptor.embedded) {
                    ZipEntry wallpaperEntry = new ZipEntry(descriptor.file);
                    wallpaperEntry.setTime(0L);
                    zip.putNextEntry(wallpaperEntry);
                    try (InputStream in = new FileInputStream(source)) {
                        copy(in, zip, descriptor.kind.equals("video") ? MAX_VIDEO_BYTES : MAX_IMAGE_BYTES, null);
                    }
                    zip.closeEntry();
                }
                zip.finish();
            }
        }
        return displayName(destination);
    }

    /** Confirm or revoke a newly imported wallpaper. A receipt cannot target old files. */
    Object finishImport(JSONObject args) throws Exception {
        if (args == null || args.isNull("receipt")) return null;
        String receipt = args.optString("receipt", "");
        if (!receipt.matches("[0-9a-fA-F-]{36}")) throw new IOException("导入收据无效");
        boolean keep = args.optBoolean("keep", false);
        JSONObject map = receipts();
        String fileName = map.optString(receipt, null);
        if (fileName == null) return null;
        File file = safeBackgroundFile(fileName);
        if (!keep && file.exists() && !file.delete()) throw new IOException("无法撤销主题壁纸导入");
        map.remove(receipt);
        saveReceipts(map);
        return null;
    }

    private JSONObject receipts() {
        try {
            return new JSONObject(receiptPreferences.getString("map", "{}"));
        } catch (JSONException e) {
            return new JSONObject();
        }
    }

    private synchronized void rememberReceipt(String receipt, File file) throws IOException {
        JSONObject map = receipts();
        try {
            map.put(receipt, file.getName());
        } catch (JSONException e) {
            deleteQuietly(file);
            throw new IOException("无法保存主题导入收据", e);
        }
        if (!receiptPreferences.edit().putString("map", map.toString()).commit()) {
            deleteQuietly(file);
            throw new IOException("无法保存主题导入收据");
        }
    }

    private void saveReceipts(JSONObject map) throws IOException {
        if (!receiptPreferences.edit().putString("map", map.toString()).commit()) {
            throw new IOException("无法更新主题导入收据");
        }
    }

    private File privateWallpaperFile(String src, String manifestFile, String kind) throws Exception {
        if (src == null || src.isEmpty()) throw new IOException("嵌入式主题缺少本地壁纸");
        Uri uri = Uri.parse(src);
        if (!"https".equals(uri.getScheme()) || !MainActivity.HOST.equals(uri.getHost()) || uri.getPort() != -1
                || uri.getQuery() != null || uri.getFragment() != null) {
            throw new IOException("壁纸必须来自心海共学本机存储");
        }
        String path = uri.getPath();
        String prefix = "/local/backgrounds/";
        if (path == null || !path.startsWith(prefix)) throw new IOException("壁纸路径无效");
        String fileName = path.substring(prefix.length());
        if (!fileName.matches("[A-Za-z0-9_-]{1,128}\\.(?:png|jpg|jpeg|webp|mp4|webm)")) {
            throw new IOException("壁纸路径无效");
        }
        String actualExt = extension(fileName);
        if (!actualExt.equals(extension(manifestFile)) || !kind.equals(kindForExtension(actualExt))) {
            throw new IOException("theme.json 与本地壁纸格式不一致");
        }
        File file = safeBackgroundFile(fileName);
        if (!file.isFile()) throw new IOException("本地壁纸不存在");
        validateMediaFile(file, actualExt, kind);
        return file;
    }

    private File safeBackgroundFile(String fileName) throws IOException {
        ensureBackgrounds();
        if (fileName == null || !fileName.matches("[A-Za-z0-9_-]{1,128}\\.(?:png|jpg|jpeg|webp|mp4|webm)")) {
            throw new IOException("本地壁纸路径无效");
        }
        File file = new File(backgrounds, fileName).getCanonicalFile();
        File root = backgrounds.getCanonicalFile();
        if (!file.getParentFile().equals(root)) throw new IOException("本地壁纸路径无效");
        return file;
    }

    private JSONObject customBackground(String name, File file, String kind) throws JSONException {
        String src = ORIGIN + "/local/backgrounds/" + file.getName();
        String poster = "video".equals(kind)
                ? (BuildConfig.COMMERCIAL_EDITION ? "/backgrounds/originals/deep-sea.png" : "/backgrounds/train-night-still.jpg")
                : src;
        return new JSONObject().put("name", name == null || name.isEmpty() ? file.getName() : name)
                .put("src", src).put("kind", kind).put("poster", poster);
    }

    private static final class WallpaperDescriptor {
        final boolean embedded;
        final String file;
        final String name;
        final String kind;

        WallpaperDescriptor(boolean embedded, String file, String name, String kind) {
            this.embedded = embedded;
            this.file = file;
            this.name = name;
            this.kind = kind;
        }
    }

    /** Validate the portable descriptor while leaving strict appearance rules to shared JS. */
    static WallpaperDescriptor validateManifest(JSONObject manifest) throws Exception {
        if (manifest == null) throw new IOException("缺少主题清单");
        checkKeys(manifest, TOP_LEVEL_FIELDS, "主题清单");
        if (!(manifest.opt("format") instanceof String)
                || !"xinhai-theme".equals(manifest.optString("format", ""))) {
            throw new IOException("主题格式不支持");
        }
        Object version = manifest.opt("version");
        if (!(version instanceof Number) || ((Number) version).doubleValue() != 1d) {
            throw new IOException("主题版本不支持");
        }
        String themeName = requireThemeName(manifest);
        if (!manifest.has("appearance") || manifest.isNull("appearance") || !(manifest.get("appearance") instanceof JSONObject)) {
            throw new IOException("主题缺少 appearance");
        }
        if (!manifest.has("wallpaper") || manifest.isNull("wallpaper") || !(manifest.get("wallpaper") instanceof JSONObject)) {
            throw new IOException("主题缺少 wallpaper");
        }
        JSONObject wallpaper = manifest.getJSONObject("wallpaper");
        if (!(wallpaper.opt("type") instanceof String)) throw new IOException("壁纸类型不支持");
        String type = wallpaper.optString("type", "");
        if ("builtin".equals(type)) {
            checkKeys(wallpaper, BUILTIN_FIELDS, "内置壁纸描述");
            if (!(wallpaper.opt("id") instanceof String)) throw new IOException("内置壁纸 ID 无效");
            String id = wallpaper.optString("id", "");
            if (!BUILTIN_IDS.contains(id)) throw new IOException("内置壁纸 ID 无效");
            return new WallpaperDescriptor(false, null, themeName, null);
        }
        if ("embedded".equals(type)) {
            checkKeys(wallpaper, EMBEDDED_FIELDS, "嵌入壁纸描述");
            if (!(wallpaper.opt("file") instanceof String) || !(wallpaper.opt("kind") instanceof String)) {
                throw new IOException("嵌入壁纸描述无效");
            }
            String file = wallpaper.optString("file", "");
            String fileExt = extension(file);
            if (!isWallpaperEntry(file) || !file.matches("wallpaper\\.(?:png|jpg|jpeg|webp|mp4|webm)")) {
                throw new IOException("嵌入壁纸文件名无效");
            }
            String kind = wallpaper.optString("kind", "");
            if (!("image".equals(kind) || "video".equals(kind)) || !kind.equals(kindForExtension(fileExt))) {
                throw new IOException("嵌入壁纸类型与扩展名不一致");
            }
            String name = requireDisplayName(wallpaper, "name", "壁纸名称", 200);
            return new WallpaperDescriptor(true, file, name, kind);
        }
        throw new IOException("壁纸类型不支持");
    }

    private static void checkKeys(JSONObject object, Set<String> allowed, String label) throws Exception {
        Iterator<String> keys = object.keys();
        while (keys.hasNext()) {
            String key = keys.next();
            if (!allowed.contains(key)) throw new IOException(label + "含有未知字段");
        }
    }

    private static String requireThemeName(JSONObject object) throws Exception {
        Object value = object.opt("name");
        if (!(value instanceof String)) throw new IOException("主题名称无效");
        String raw = (String) value;
        if (containsThemeControl(raw)) throw new IOException("主题名称无效");
        String text = raw.trim();
        if (text.isEmpty() || text.codePointCount(0, text.length()) > 40) throw new IOException("主题名称无效");
        return text;
    }

    private static String requireDisplayName(JSONObject object, String key, String label, int max) throws Exception {
        Object value = object.opt(key);
        if (!(value instanceof String)) throw new IOException(label + "无效");
        String text = (String) value;
        if (text.trim().isEmpty() || text.length() > max || containsDisplayControl(text)) {
            throw new IOException(label + "无效");
        }
        return text;
    }

    private static boolean containsThemeControl(String value) {
        for (int i = 0; i < value.length(); i++) {
            char c = value.charAt(i);
            if (c < 0x20 || c == 0x7f) return true;
        }
        return false;
    }

    private static boolean containsDisplayControl(String value) {
        for (int i = 0; i < value.length(); i++) if (value.charAt(i) < 0x20) return true;
        return false;
    }

    private static void validateEntryName(String name) throws IOException {
        if (name == null || name.isEmpty() || name.indexOf('\u0000') >= 0 || name.indexOf('\\') >= 0
                || name.startsWith("/") || name.startsWith("./") || name.contains(":")) {
            throw new IOException("主题 ZIP 路径无效");
        }
        String[] parts = name.split("/", -1);
        for (String part : parts) if (part.isEmpty() || ".".equals(part) || "..".equals(part)) {
            throw new IOException("主题 ZIP 路径穿越");
        }
    }

    private static boolean isWallpaperEntry(String name) {
        return name != null && name.matches("wallpaper\\.(?:png|jpg|jpeg|webp|mp4|webm)");
    }

    private static String kindForExtension(String ext) {
        if (IMAGE_EXTENSIONS.contains(ext)) return "image";
        if (VIDEO_EXTENSIONS.contains(ext)) return "video";
        return null;
    }

    private static String extension(String name) {
        if (name == null) return "";
        int dot = name.lastIndexOf('.');
        return dot >= 0 && dot + 1 < name.length() ? name.substring(dot + 1).toLowerCase(Locale.ROOT) : "";
    }

    private void validateMediaFile(File file, String ext, String kind) throws IOException {
        if (file == null || !file.isFile() || file.length() == 0) throw new IOException("壁纸文件为空");
        if ("image".equals(kind)) {
            if (!hasImageSignature(file, ext)) throw new IOException("图片格式与扩展名不一致");
            BitmapFactory.Options options = new BitmapFactory.Options();
            options.inJustDecodeBounds = true;
            BitmapFactory.decodeFile(file.getAbsolutePath(), options);
            if (options.outWidth <= 0 || options.outHeight <= 0) throw new IOException("图片无法解码");
            if ((long) options.outWidth * (long) options.outHeight > MAX_IMAGE_PIXELS) {
                throw new IOException("图片像素超过 100M");
            }
        } else if ("video".equals(kind)) {
            if (!hasVideoSignature(file, ext)) throw new IOException("视频格式与扩展名不一致");
        } else {
            throw new IOException("媒体类型无效");
        }
    }

    private static boolean hasImageSignature(File file, String ext) throws IOException {
        byte[] header = readHeader(file, 16);
        if ("png".equals(ext)) return header.length >= 8
                && (header[0] & 255) == 0x89 && header[1] == 0x50 && header[2] == 0x4e && header[3] == 0x47
                && header[4] == 0x0d && header[5] == 0x0a && header[6] == 0x1a && header[7] == 0x0a;
        if ("jpg".equals(ext) || "jpeg".equals(ext)) return header.length >= 3
                && (header[0] & 255) == 0xff && (header[1] & 255) == 0xd8 && (header[2] & 255) == 0xff;
        return "webp".equals(ext) && header.length >= 12
                && header[0] == 'R' && header[1] == 'I' && header[2] == 'F' && header[3] == 'F'
                && header[8] == 'W' && header[9] == 'E' && header[10] == 'B' && header[11] == 'P';
    }

    private static boolean hasVideoSignature(File file, String ext) throws IOException {
        byte[] header = readHeader(file, 16);
        if ("mp4".equals(ext)) return header.length >= 12
                && header[4] == 'f' && header[5] == 't' && header[6] == 'y' && header[7] == 'p';
        return "webm".equals(ext) && header.length >= 4
                && (header[0] & 255) == 0x1a && (header[1] & 255) == 0x45
                && (header[2] & 255) == 0xdf && (header[3] & 255) == 0xa3;
    }

    private static byte[] readHeader(File file, int limit) throws IOException {
        try (InputStream in = new FileInputStream(file)) {
            ByteArrayOutputStream out = new ByteArrayOutputStream(limit);
            byte[] buffer = new byte[limit];
            int n = in.read(buffer);
            if (n > 0) out.write(buffer, 0, n);
            return out.toByteArray();
        }
    }

    private static byte[] readEntry(InputStream in, long limit, long[] total) throws IOException {
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        copy(in, out, limit, total);
        return out.toByteArray();
    }

    private static void copyEntry(InputStream in, OutputStream out, long limit, long[] total) throws IOException {
        copy(in, out, limit, total);
    }

    private static void copy(InputStream in, OutputStream out, long limit, long[] total) throws IOException {
        byte[] buffer = new byte[64 * 1024];
        long local = 0L;
        int n;
        while ((n = in.read(buffer)) != -1) {
            local += n;
            if (local > limit || (total != null && total[0] > MAX_ZIP_BYTES - n)) {
                throw new IOException("解压后文件超过大小限制");
            }
            if (total != null) total[0] += n;
            out.write(buffer, 0, n);
        }
    }

    private void ensureBackgrounds() throws IOException {
        if (!backgrounds.exists() && !backgrounds.mkdirs()) throw new IOException("无法创建导入目录");
        if (!backgrounds.isDirectory()) throw new IOException("导入目录无效");
    }

    private static void deleteQuietly(File file) {
        if (file != null && file.exists()) file.delete();
    }

    private String displayName(Uri uri) {
        try (android.database.Cursor cursor = resolver.query(uri,
                new String[]{OpenableColumns.DISPLAY_NAME}, null, null, null)) {
            if (cursor != null && cursor.moveToFirst()) return cursor.getString(0);
        } catch (Exception ignored) {
        }
        return "xinhai-theme.zip";
    }

    private static final class CountingInputStream extends InputStream {
        private final InputStream delegate;
        private final long limit;
        long count;

        CountingInputStream(InputStream delegate, long limit) {
            this.delegate = delegate;
            this.limit = limit;
        }

        @Override public int read() throws IOException {
            int value = delegate.read();
            if (value >= 0) increment(1);
            return value;
        }

        @Override public int read(byte[] buffer, int offset, int length) throws IOException {
            int n = delegate.read(buffer, offset, length);
            if (n > 0) increment(n);
            return n;
        }

        private void increment(long amount) throws IOException {
            if (count > limit - amount) throw new IOException("主题 ZIP 超过大小限制");
            count += amount;
        }

        @Override public void close() throws IOException { delegate.close(); }
    }

    private static final class CountingOutputStream extends FilterOutputStream {
        private final long limit;
        long count;

        CountingOutputStream(OutputStream delegate, long limit) {
            super(delegate);
            this.limit = limit;
        }

        @Override public void write(int value) throws IOException {
            if (count >= limit) throw new IOException("主题 ZIP 超过大小限制");
            out.write(value);
            count++;
        }

        @Override public void write(byte[] buffer, int offset, int length) throws IOException {
            if (length > limit - count) throw new IOException("主题 ZIP 超过大小限制");
            out.write(buffer, offset, length);
            count += length;
        }
    }

    private static final class DigestOutputStream extends FilterOutputStream {
        private final MessageDigest digest;
        private final long limit;
        long count;

        DigestOutputStream(OutputStream delegate, MessageDigest digest, long limit) {
            super(delegate);
            this.digest = digest;
            this.limit = limit;
        }

        @Override public void write(int value) throws IOException {
            if (count >= limit) throw new IOException("文件超出大小限制");
            out.write(value);
            digest.update((byte) value);
            count++;
        }

        @Override public void write(byte[] buffer, int offset, int length) throws IOException {
            if (length > limit - count) throw new IOException("文件超出大小限制");
            out.write(buffer, offset, length);
            digest.update(buffer, offset, length);
            count += length;
        }
    }
}
