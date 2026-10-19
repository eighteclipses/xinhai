package com.xinhai.study;

import android.content.ContentResolver;
import android.content.Context;
import android.database.Cursor;
import android.net.Uri;
import android.provider.DocumentsContract;
import android.provider.OpenableColumns;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.FilterOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.nio.charset.CharacterCodingException;
import java.nio.charset.CodingErrorAction;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.security.MessageDigest;
import java.text.Normalizer;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Collections;
import java.util.Comparator;
import java.util.HashMap;
import java.util.HashSet;
import java.util.Iterator;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import java.util.regex.Pattern;
import java.util.zip.ZipEntry;
import java.util.zip.ZipException;
import java.util.zip.ZipInputStream;
import java.util.zip.ZipOutputStream;

/**
 * Streaming Android file layer for the full xinhai backup archive.
 *
 * This class deliberately does not know how to replace SQLite rows.  It only
 * validates, hashes, exports, and prepares private files.  The shared
 * restore coordinator owns database transactions and supplies the resulting
 * file references back to the native bridge.
 */
final class BackupFiles {
    static final long MAX_ARCHIVE_BYTES = 2L * 1024L * 1024L * 1024L;
    static final long MAX_FILE_BYTES = 512L * 1024L * 1024L;
    static final long MAX_DATABASE_BYTES = 16L * 1024L * 1024L;
    static final long MAX_MANIFEST_BYTES = 4L * 1024L * 1024L;
    static final long MAX_FILE_COUNT = 10000L;
    private static final String ORIGIN = "https://" + MainActivity.HOST;
    private static final String STATE_PREFS = "xinhai-backup-files";
    private static final Set<String> WALLPAPER_EXTENSIONS = new HashSet<>(Arrays.asList(
            "png", "jpg", "jpeg", "webp", "mp4", "webm"));
    private static final Set<String> IMAGE_EXTENSIONS = new HashSet<>(Arrays.asList(
            "png", "jpg", "jpeg", "webp"));
    private static final Set<String> VIDEO_EXTENSIONS = new HashSet<>(Arrays.asList(
            "mp4", "webm"));
    private static final Set<String> MUSIC_EXTENSIONS = new HashSet<>(Arrays.asList(
            "mp3", "ogg", "wav", "flac", "m4a", "aac", "opus"));
    private static final Pattern MEDIA_ID = Pattern.compile("m[0-9]{6}");
    private static final Pattern SHA256 = Pattern.compile("[0-9a-f]{64}");
    private static final Pattern TICKET = Pattern.compile("[0-9a-fA-F-]{36}");
    private static final Pattern SAFE_MEDIA_NAME = Pattern.compile("[A-Za-z0-9_-]{1,160}\\.[a-z0-9]+");

    private final Context context;
    private final ContentResolver resolver;
    private final File filesRoot;
    private final File backgrounds;
    private final File music;

    BackupFiles(Context source) {
        Context app = source.getApplicationContext();
        context = app == null ? source : app;
        resolver = context.getContentResolver();
        try {
            filesRoot = context.getFilesDir().getCanonicalFile();
            backgrounds = new File(filesRoot, "backgrounds").getCanonicalFile();
            music = new File(filesRoot, "music").getCanonicalFile();
        } catch (IOException e) {
            throw new IllegalStateException("无法定位应用私有目录", e);
        }
    }

    /** Export a complete archive to a user-selected destination URI. */
    String exportArchive(Uri destination, JSONObject snapshot, JSONArray mediaSources,
                         String knowledgeTree, String localKnowledgeRoot) throws Exception {
        if (destination == null) throw new IOException("未选择备份保存位置");
        byte[] databaseBytes = snapshotBytes(snapshot);
        ArrayList<ArchiveEntry> entries = new ArrayList<>();
        entries.add(ArchiveEntry.bytes("database.json", "database", databaseBytes, null));
        PathRegistry paths = new PathRegistry();
        paths.add("database.json");

        Set<String> mediaIds = new HashSet<>();
        if (mediaSources != null) {
            for (int i = 0; i < mediaSources.length(); i++) {
                JSONObject source = mediaSources.getJSONObject(i);
                checkExact(source, "id", "kind", "source", "extension");
                String id = source.getString("id");
                String kind = source.getString("kind");
                String extension = lowerExtension(source.getString("extension"));
                if (!MEDIA_ID.matcher(id).matches() || !mediaIds.add(id)) {
                    throw new IOException("备份媒体编号重复或无效: " + id);
                }
                if (!("wallpaper".equals(kind) || "music".equals(kind))) {
                    throw new IOException("备份媒体类型无效");
                }
                if (!extensionAllowed(kind, extension)) {
                    throw new IOException("备份媒体扩展名无效");
                }
                SourceFile sourceFile = resolveMediaSource(source.getString("source"), kind, id, extension);
                String archivePath = "media/" + id + "." + extension;
                paths.add(archivePath);
                entries.add(ArchiveEntry.source(archivePath, kind, id, sourceFile));
            }
        }

        ArrayList<String> directories = new ArrayList<>();
        enumerateKnowledge(knowledgeTree, localKnowledgeRoot, entries, directories, paths);
        Collections.sort(directories);
        if (entries.size() > MAX_FILE_COUNT) throw new IOException("备份文件数量超过限制");

        for (ArchiveEntry entry : entries) entry.prepareHash(resolver);
        JSONObject manifest = new JSONObject()
                .put("format", "xinhai-backup")
                .put("version", 1)
                .put("appVersion", BuildConfig.VERSION_NAME)
                .put("createdAt", System.currentTimeMillis())
                .put("files", manifestFiles(entries))
                .put("directories", new JSONArray(directories));
        byte[] manifestBytes = manifest.toString().getBytes(StandardCharsets.UTF_8);
        if (manifestBytes.length > MAX_MANIFEST_BYTES) throw new IOException("backup.json 超过 4 MiB");
        long expanded = manifestBytes.length;
        for (ArchiveEntry entry : entries) {
            if (entry.size > MAX_FILE_BYTES || "database".equals(entry.kind) && entry.size > MAX_DATABASE_BYTES) {
                throw new IOException("备份文件超过大小限制");
            }
            expanded = addLimited(expanded, entry.size, MAX_ARCHIVE_BYTES);
        }

        File staging = new File(filesRoot, "backup-staging");
        if (!staging.exists() && !staging.mkdirs()) throw new IOException("无法创建备份临时目录");
        File temporary = new File(staging, "." + UUID.randomUUID() + ".xinhai-backup.part");
        try {
            try (OutputStream raw = new FileOutputStream(temporary);
                 LimitedOutputStream limited = new LimitedOutputStream(raw, MAX_ARCHIVE_BYTES);
                 ZipOutputStream zip = new ZipOutputStream(limited)) {
                putBytes(zip, "backup.json", manifestBytes);
                for (ArchiveEntry entry : entries) writeArchiveEntry(zip, entry);
                zip.finish();
            }
            if (temporary.length() > MAX_ARCHIVE_BYTES) throw new IOException("备份压缩包超过 2 GiB");
            try (InputStream in = new FileInputStream(temporary);
                 OutputStream out = resolver.openOutputStream(destination, "wt")) {
                if (out == null) throw new IOException("无法写入备份文件");
                copyLimited(in, out, MAX_ARCHIVE_BYTES, null);
            }
            return displayName(destination);
        } finally {
            deleteQuietly(temporary);
        }
    }

    /** Prepare and fully validate an archive into a new ticket-owned private tree. */
    JSONObject prepareArchive(Uri source, String displayName) throws Exception {
        String ext = lowerExtension(displayName == null ? "" : displayName);
        if (!("zip".equals(ext) || "xinhai-backup".equals(ext))) {
            throw new IOException("备份文件必须是 .xinhai-backup 或 .zip");
        }
        InputStream raw = resolver.openInputStream(source);
        if (raw == null) throw new IOException("无法读取备份文件");
        String ticket = UUID.randomUUID().toString();
        File restored = new File(filesRoot, "restored").getCanonicalFile();
        if (!restored.exists() && !restored.mkdirs()) throw new IOException("无法创建恢复目录");
        File ticketRoot = new File(restored, ticket).getCanonicalFile();
        if (ticketRoot.exists() || !ticketRoot.mkdirs()) throw new IOException("无法创建恢复票据目录");
        File knowledgeRoot = new File(ticketRoot, "knowledge").getCanonicalFile();
        File stagedMedia = new File(ticketRoot, ".media").getCanonicalFile();
        if (!knowledgeRoot.mkdirs() || !stagedMedia.mkdirs()) {
            deleteQuietly(ticketRoot);
            throw new IOException("无法创建恢复临时目录");
        }
        ArrayList<StagedEntry> staged = new ArrayList<>();
        PathRegistry paths = new PathRegistry();
        byte[] manifestBytes = null;
        boolean databaseSeen = false;
        long[] expanded = {0L};
        try (InputStream selected = raw;
             CountingInputStream counted = new CountingInputStream(selected, MAX_ARCHIVE_BYTES);
             ZipInputStream zip = new ZipInputStream(counted)) {
            Set<String> rawNames = new HashSet<>();
            ZipEntry entry;
            while ((entry = zip.getNextEntry()) != null) {
                String name = entry.getName();
                if (!rawNames.add(name)) throw new IOException("备份 ZIP 含有重复文件");
                if (entry.isDirectory() || name.endsWith("/")) throw new IOException("备份 ZIP 不允许目录条目");
                if (entry.getMethod() != ZipEntry.STORED && entry.getMethod() != ZipEntry.DEFLATED) {
                    throw new IOException("备份 ZIP 压缩方式不受支持");
                }
                if ("backup.json".equals(name)) {
                    if (manifestBytes != null) throw new IOException("backup.json 重复");
                    manifestBytes = readBytes(zip, MAX_MANIFEST_BYTES, expanded);
                } else if ("database.json".equals(name)) {
                    if (databaseSeen) throw new IOException("database.json 重复");
                    databaseSeen = true;
                    File target = new File(ticketRoot, "database.json");
                    DigestResult result = copyToFile(zip, target, MAX_DATABASE_BYTES, expanded);
                    staged.add(new StagedEntry(name, "database", null, target, result.size, result.sha256));
                    paths.add(name);
                } else if (name.startsWith("media/")) {
                    validateStagedMediaPath(name);
                    File target = childFile(stagedMedia, name.substring("media/".length()));
                    DigestResult result = copyToFile(zip, target, MAX_FILE_BYTES, expanded);
                    staged.add(new StagedEntry(name, "media", null, target, result.size, result.sha256));
                    paths.add(name);
                } else if (name.startsWith("knowledge/")) {
                    String relative = name.substring("knowledge/".length());
                    validateRelativePath(relative);
                    File target = childFile(knowledgeRoot, relative);
                    DigestResult result = copyToFile(zip, target, MAX_FILE_BYTES, expanded);
                    staged.add(new StagedEntry(name, "knowledge", null, target, result.size, result.sha256));
                    paths.add(name);
                } else {
                    throw new IOException("备份 ZIP 含有未知文件: " + name);
                }
                zip.closeEntry();
                if (counted.count > MAX_ARCHIVE_BYTES || expanded[0] > MAX_ARCHIVE_BYTES) {
                    throw new IOException("备份 ZIP 超过大小限制");
                }
            }
            byte[] trailing = new byte[64 * 1024];
            while (counted.read(trailing, 0, trailing.length) != -1) {
                // Count the complete selected file, including ZIP comments.
            }
            if (counted.count > MAX_ARCHIVE_BYTES) throw new IOException("备份 ZIP 超过 2 GiB");
        } catch (ZipException e) {
            deleteQuietly(ticketRoot);
            throw new IOException("备份 ZIP 无效或已加密", e);
        } catch (Exception e) {
            deleteQuietly(ticketRoot);
            throw e;
        }

        ArrayList<String> createdFiles = new ArrayList<>();
        try {
            if (manifestBytes == null || !databaseSeen) throw new IOException("备份缺少清单或数据库");
            JSONObject manifest = parseJson(manifestBytes, "backup.json");
            ManifestInfo info = validateManifest(manifest);
            validateStagedEntries(info, staged, manifestBytes.length, expanded[0]);
            File database = new File(ticketRoot, "database.json");
            JSONObject snapshot = parseJson(readFile(database, MAX_DATABASE_BYTES), "database.json");
            validateSnapshotBasic(snapshot);
            applyEmptyDirectories(info.directories, knowledgeRoot, info.filePaths);

            JSONObject media = new JSONObject();
            for (ManifestEntry entry : info.files) {
                if (!("wallpaper".equals(entry.kind) || "music".equals(entry.kind))) continue;
                StagedEntry stagedEntry = findStaged(staged, entry.path);
                File destination = mediaDestination(ticket, entry);
                if (destination.exists()) throw new IOException("恢复媒体文件已存在");
                File parent = destination.getParentFile();
                if (!parent.exists() && !parent.mkdirs()) throw new IOException("无法创建媒体目录");
                if (!stagedEntry.file.renameTo(destination)) throw new IOException("保存恢复媒体失败");
                createdFiles.add(destination.getCanonicalPath());
                String local = "wallpaper".equals(entry.kind) ? "backgrounds" : "music";
                media.put(entry.id, new JSONObject()
                        .put("path", destination.getCanonicalPath())
                        .put("url", ORIGIN + "/local/" + local + "/" + destination.getName()));
            }
            deleteQuietly(stagedMedia);
            if (!database.delete()) throw new IOException("无法清理恢复临时数据库");
            JSONObject resources = new JSONObject()
                    .put("knowledgeRoot", "本机学习库")
                    .put("androidKnowledgeRoot", knowledgeRoot.getCanonicalPath())
                    .put("media", media);
            rememberTicket(ticket, ticketRoot, createdFiles, manifest);
            return new JSONObject().put("ticket", ticket)
                    .put("manifest", manifest)
                    .put("snapshot", snapshot)
                    .put("resources", resources);
        } catch (Exception e) {
            for (String path : createdFiles) deleteQuietly(new File(path));
            deleteQuietly(ticketRoot);
            throw e;
        }
    }

    /** Re-check every prepared private file immediately before database commit. */
    synchronized Object verifyImport(String ticket) throws Exception {
        if (ticket == null || !TICKET.matcher(ticket).matches()) throw new IOException("恢复票据无效");
        JSONObject state = ticketStates().optJSONObject(ticket);
        if (state == null) throw new IOException("恢复票据不存在或已经结束");
        File root = new File(state.getString("root")).getCanonicalFile();
        if (!isPrivateRestoredRoot(root, ticket)) throw new IOException("恢复票据目录越界");
        JSONObject manifestObject = state.optJSONObject("manifest");
        if (manifestObject == null) throw new IOException("恢复票据清单缺失");
        ManifestInfo info = validateManifest(manifestObject);
        File knowledgeRoot = new File(root, "knowledge").getCanonicalFile();
        if (!knowledgeRoot.isDirectory() || Files.isSymbolicLink(knowledgeRoot.toPath())) throw new IOException("恢复知识库目录不存在");
        for (String directory : info.directories) {
            File directoryFile = "knowledge".equals(directory) ? knowledgeRoot
                    : childFile(knowledgeRoot, directory.substring("knowledge/".length()));
            if (!directoryFile.isDirectory() || Files.isSymbolicLink(directoryFile.toPath())) throw new IOException("恢复目录已丢失: " + directory);
        }
        for (ManifestEntry entry : info.files) {
            File file;
            if ("knowledge".equals(entry.kind)) {
                file = childFile(knowledgeRoot, entry.path.substring("knowledge/".length()));
            } else if ("wallpaper".equals(entry.kind) || "music".equals(entry.kind)) {
                file = mediaDestination(ticket, entry);
            } else {
                // database.json is returned to the shared coordinator and is
                // not kept as a private file after prepare completes.
                continue;
            }
            if (Files.isSymbolicLink(file.toPath()) || !file.isFile()) throw new IOException("恢复文件已丢失: " + entry.path);
            DigestResult result = digestLocal(file, MAX_FILE_BYTES);
            if (result.size != entry.size || !entry.sha256.equals(result.sha256)) throw new IOException("恢复文件已改变: " + entry.path);
        }
        return null;
    }

    /** Keep or roll back only files registered to this preparation ticket. */
    synchronized Object finishArchive(String ticket, boolean keep) throws Exception {
        if (ticket == null || !TICKET.matcher(ticket).matches()) throw new IOException("恢复票据无效");
        JSONObject all = ticketStates();
        JSONObject state = all.optJSONObject(ticket);
        if (state == null) return null;
        File root = new File(filesRoot, "restored/" + ticket).getCanonicalFile();
        if (!keep) {
            JSONArray files = state.optJSONArray("files");
            if (files != null) for (int i = 0; i < files.length(); i++) {
                File file = new File(files.getString(i)).getCanonicalFile();
                if (!isPrivateTicketFile(file, ticket)) throw new IOException("恢复票据文件越界");
                if (file.exists() && !file.delete()) throw new IOException("无法撤销恢复媒体");
            }
            if (!isPrivateRestoredRoot(root, ticket)) throw new IOException("恢复票据目录越界");
            deleteQuietly(root);
        }
        all.remove(ticket);
        saveTicketStates(all);
        return null;
    }

    private byte[] snapshotBytes(JSONObject snapshotObject) throws Exception {
        if (snapshotObject == null) throw new IOException("缺少数据库快照");
        validateSnapshotBasic(snapshotObject);
        byte[] bytes = snapshotObject.toString().getBytes(StandardCharsets.UTF_8);
        if (bytes.length > MAX_DATABASE_BYTES) throw new IOException("database.json 超过 16 MiB");
        return bytes;
    }

    private void validateSnapshotBasic(JSONObject snapshot) throws IOException {
        if (snapshot == null || !"xinhai-database-snapshot".equals(snapshot.optString("format", ""))
                || !(snapshot.opt("version") instanceof Number)
                || (snapshot.optDouble("version", -1) != 1 && snapshot.optDouble("version", -1) != 2 && snapshot.optDouble("version", -1) != 3)
                || !(snapshot.opt("tables") instanceof JSONObject)
                || !(snapshot.opt("sequences") instanceof JSONObject)
                || !(snapshot.opt("clientState") instanceof JSONObject)) {
            throw new IOException("database.json 基本结构无效");
        }
    }

    private JSONArray manifestFiles(List<ArchiveEntry> entries) throws JSONException {
        JSONArray files = new JSONArray();
        for (ArchiveEntry entry : entries) {
            JSONObject value = new JSONObject()
                    .put("path", entry.path)
                    .put("kind", entry.kind)
                    .put("size", entry.size)
                    .put("sha256", entry.sha256);
            if (entry.id != null) value.put("id", entry.id);
            files.put(value);
        }
        return files;
    }

    private void writeArchiveEntry(ZipOutputStream zip, ArchiveEntry entry) throws Exception {
        zip.putNextEntry(new ZipEntry(entry.path));
        if (entry.bytes != null) {
            zip.write(entry.bytes);
        } else {
            DigestResult result = copySource(entry.source, zip, MAX_FILE_BYTES);
            if (result.size != entry.size || !entry.sha256.equals(result.sha256)) {
                throw new IOException("备份源文件在导出期间发生变化: " + entry.path);
            }
        }
        zip.closeEntry();
    }

    private void enumerateKnowledge(String tree, String localRoot, ArrayList<ArchiveEntry> entries,
                                   ArrayList<String> directories, PathRegistry paths) throws Exception {
        if (tree != null && !tree.isEmpty()) {
            Uri uri = Uri.parse(tree);
            if (!"content".equals(uri.getScheme()) || uri.getAuthority() == null) {
                throw new IOException("学习库 SAF 引用无效");
            }
            scanSaf(uri, DocumentsContract.getTreeDocumentId(uri), "", entries, directories, paths, 0);
        } else {
            File root = localKnowledgeRoot(localRoot);
            scanLocal(root, "", entries, directories, paths, 0);
        }
    }

    private File localKnowledgeRoot(String configured) throws IOException {
        File root = configured == null || configured.isEmpty()
                ? new File(filesRoot, "knowledge") : new File(configured);
        File canonical = root.getCanonicalFile();
        if (!isWithin(canonical, filesRoot) || canonical.equals(filesRoot)) {
            throw new IOException("本机学习库必须位于应用私有目录");
        }
        if (Files.isSymbolicLink(canonical.toPath())) throw new IOException("本机学习库不能是符号链接");
        if (!canonical.exists() && !canonical.mkdirs()) throw new IOException("无法创建本机学习库");
        if (!canonical.isDirectory()) throw new IOException("本机学习库路径无效");
        return canonical;
    }

    private void scanLocal(File directory, String relative, ArrayList<ArchiveEntry> entries,
                           ArrayList<String> directories, PathRegistry paths, int depth) throws Exception {
        if (depth > 128) throw new IOException("知识库目录层级过深");
        File canonical = directory.getCanonicalFile();
        if (Files.isSymbolicLink(directory.toPath()) || !canonical.isDirectory()) throw new IOException("知识库包含无效目录");
        File[] children = canonical.listFiles();
        if (children == null) throw new IOException("无法读取知识库");
        Arrays.sort(children, Comparator.comparing(File::getName));
        if (!relative.isEmpty()) directories.add("knowledge/" + relative);
        for (File child : children) {
            validateSegment(child.getName());
            if (Files.isSymbolicLink(child.toPath())) throw new IOException("知识库不允许符号链接");
            String childRelative = relative.isEmpty() ? child.getName() : relative + "/" + child.getName();
            String archivePath = "knowledge/" + childRelative;
            paths.add(archivePath);
            File childCanonical = child.getCanonicalFile();
            if (!isWithin(childCanonical, canonical)) throw new IOException("知识库路径越界");
            if (child.isDirectory()) {
                scanLocal(childCanonical, childRelative, entries, directories, paths, depth + 1);
            } else if (child.isFile()) {
                entries.add(ArchiveEntry.source(archivePath, "knowledge", null, SourceFile.local(childCanonical)));
            } else {
                throw new IOException("知识库包含无法读取的文件");
            }
        }
    }

    private void scanSaf(Uri tree, String documentId, String relative, ArrayList<ArchiveEntry> entries,
                         ArrayList<String> directories, PathRegistry paths, int depth) throws Exception {
        if (depth > 128) throw new IOException("知识库目录层级过深");
        Uri childrenUri = DocumentsContract.buildChildDocumentsUriUsingTree(tree, documentId);
        ArrayList<SafChild> children = new ArrayList<>();
        String[] columns = {DocumentsContract.Document.COLUMN_DOCUMENT_ID,
                DocumentsContract.Document.COLUMN_DISPLAY_NAME,
                DocumentsContract.Document.COLUMN_MIME_TYPE,
                DocumentsContract.Document.COLUMN_SIZE,
                DocumentsContract.Document.COLUMN_LAST_MODIFIED};
        try (Cursor cursor = resolver.query(childrenUri, columns, null, null, null)) {
            if (cursor == null) throw new IOException("无法读取授权学习库");
            while (cursor.moveToNext()) {
                String id = cursor.getString(0);
                String name = cursor.getString(1);
                String mime = cursor.getString(2);
                if (id == null || name == null || mime == null) throw new IOException("学习库条目无效");
                validateSegment(name);
                if (mime.toLowerCase(Locale.ROOT).contains("symlink")) throw new IOException("知识库不允许符号链接");
                long size = cursor.isNull(3) ? -1L : cursor.getLong(3);
                long modified = cursor.isNull(4) ? -1L : cursor.getLong(4);
                children.add(new SafChild(id, name, mime, size, modified));
            }
        }
        children.sort(Comparator.comparing(child -> child.name));
        if (!relative.isEmpty()) directories.add("knowledge/" + relative);
        for (SafChild child : children) {
            String childRelative = relative.isEmpty() ? child.name : relative + "/" + child.name;
            String archivePath = "knowledge/" + childRelative;
            paths.add(archivePath);
            Uri uri = DocumentsContract.buildDocumentUriUsingTree(tree, child.id);
            if (DocumentsContract.Document.MIME_TYPE_DIR.equals(child.mime)) {
                scanSaf(tree, child.id, childRelative, entries, directories, paths, depth + 1);
            } else {
                entries.add(ArchiveEntry.source(archivePath, "knowledge", null,
                        SourceFile.saf(uri, child.size, child.modified)));
            }
        }
    }

    private SourceFile resolveMediaSource(String source, String kind, String id, String extension) throws Exception {
        if (source == null || source.isEmpty()) throw new IOException("备份媒体来源为空");
        File root = "wallpaper".equals(kind) ? backgrounds : music;
        String fileName;
        File requestedFile = null;
        Uri uri = Uri.parse(source);
        if ("https".equals(uri.getScheme()) && MainActivity.HOST.equals(uri.getHost())
                && uri.getPort() == -1 && uri.getQuery() == null && uri.getFragment() == null) {
            String prefix = "wallpaper".equals(kind) ? "/local/backgrounds/" : "/local/music/";
            String path = uri.getPath();
            if (path == null || !path.startsWith(prefix)) throw new IOException("备份媒体来源不属于本机存储");
            fileName = path.substring(prefix.length());
        } else if (uri.getScheme() == null && source.startsWith(File.separator)) {
            requestedFile = new File(source).getCanonicalFile();
            if (!requestedFile.getParentFile().equals(root)) throw new IOException("备份媒体来源路径越界");
            fileName = requestedFile.getName();
        } else {
            throw new IOException("备份媒体来源不受信任");
        }
        if (!SAFE_MEDIA_NAME.matcher(fileName).matches()
                || !extension.equals(lowerExtension(fileName))) {
            throw new IOException("备份媒体来源与编号不一致");
        }
        File file = new File(root, fileName).getCanonicalFile();
        if (!isWithin(file, root) || file.getParentFile() == null || !file.getParentFile().equals(root)) {
            throw new IOException("备份媒体路径越界");
        }
        if (requestedFile != null && !requestedFile.equals(file)) throw new IOException("备份媒体来源不一致");
        if (Files.isSymbolicLink(file.toPath()) || !file.isFile()) throw new IOException("备份媒体文件不存在");
        return SourceFile.local(file);
    }

    private File mediaDestination(String ticket, ManifestEntry entry) throws IOException {
        File root = "wallpaper".equals(entry.kind) ? backgrounds : music;
        File file = new File(root, ticket + "_" + entry.id + "." + extensionFromPath(entry.path)).getCanonicalFile();
        if (!isWithin(file, root) || !file.getParentFile().equals(root)) throw new IOException("恢复媒体路径越界");
        return file;
    }

    private void validateStagedMediaPath(String path) throws IOException {
        if (!path.matches("media/m[0-9]{6}\\.(?:png|jpg|jpeg|webp|mp4|webm|mp3|ogg|wav|flac|m4a|aac|opus)")) {
            throw new IOException("备份媒体路径无效");
        }
    }

    private ManifestInfo validateManifest(JSONObject manifest) throws Exception {
        checkExact(manifest, "format", "version", "appVersion", "createdAt", "files", "directories");
        if (!"xinhai-backup".equals(manifest.optString("format", "")) || manifest.optInt("version", -1) != 1) {
            throw new IOException("备份格式或版本不支持");
        }
        if (!(manifest.opt("appVersion") instanceof String) || manifest.getString("appVersion").length() > 200
                || !(manifest.opt("createdAt") instanceof Number)) throw new IOException("备份清单元数据无效");
        Object filesValue = manifest.opt("files");
        Object directoriesValue = manifest.opt("directories");
        if (!(filesValue instanceof JSONArray) || !(directoriesValue instanceof JSONArray)) throw new IOException("备份清单数组无效");
        JSONArray files = (JSONArray) filesValue;
        if (files.length() == 0 || files.length() > MAX_FILE_COUNT) throw new IOException("备份文件数量无效");
        ArrayList<ManifestEntry> entries = new ArrayList<>();
        PathRegistry paths = new PathRegistry();
        int databaseCount = 0;
        for (int i = 0; i < files.length(); i++) {
            JSONObject value = files.getJSONObject(i);
            String kind = value.optString("kind", "");
            boolean media = "wallpaper".equals(kind) || "music".equals(kind);
            if (media) checkExact(value, "path", "kind", "size", "sha256", "id");
            else checkExact(value, "path", "kind", "size", "sha256");
            String path = value.getString("path");
            paths.add(path);
            long size = number(value.get("size"), "文件大小");
            if (size > MAX_FILE_BYTES || "database".equals(kind) && size > MAX_DATABASE_BYTES) throw new IOException("备份文件大小无效");
            String hash = value.getString("sha256");
            if (!SHA256.matcher(hash).matches()) throw new IOException("备份 SHA-256 无效");
            String id = null;
            if ("database".equals(kind)) {
                if (!"database.json".equals(path)) throw new IOException("数据库清单路径无效");
                databaseCount++;
            } else if (media) {
                id = value.getString("id");
                if (!MEDIA_ID.matcher(id).matches() || !path.equals("media/" + id + "." + extensionFromPath(path))) {
                    throw new IOException("媒体清单编号无效");
                }
                String extension = extensionFromPath(path);
                if (!extensionAllowed(kind, extension)) throw new IOException("媒体清单类型与扩展名不一致");
            } else if ("knowledge".equals(kind)) {
                if (!path.startsWith("knowledge/") || path.length() <= "knowledge/".length()) throw new IOException("知识库清单路径无效");
                validateRelativePath(path.substring("knowledge/".length()));
            } else {
                throw new IOException("备份清单含有未知文件类型");
            }
            entries.add(new ManifestEntry(path, kind, id, size, hash));
        }
        if (databaseCount != 1) throw new IOException("备份必须包含一个 database.json");
        JSONArray dirs = (JSONArray) directoriesValue;
        ArrayList<String> directories = new ArrayList<>();
        PathRegistry directoryPaths = new PathRegistry();
        if (dirs.length() > MAX_FILE_COUNT) throw new IOException("备份目录数量超过限制");
        for (int i = 0; i < dirs.length(); i++) {
            String path = dirs.getString(i);
            if (!path.startsWith("knowledge/") || path.length() <= "knowledge/".length()) throw new IOException("知识库目录路径无效");
            validateRelativePath(path.substring("knowledge/".length()));
            directoryPaths.add(path);
            if (paths.contains(path)) throw new IOException("清单文件与目录冲突");
            directories.add(path);
        }
        for (String directory : directories) {
            for (ManifestEntry file : entries) {
                if (file.path.startsWith(directory + "/")) continue;
                if (directory.startsWith(file.path + "/")) throw new IOException("文件不能作为目录祖先");
            }
        }
        Set<String> ids = new HashSet<>();
        for (ManifestEntry entry : entries) if (entry.id != null && !ids.add(entry.id)) throw new IOException("媒体编号重复");
        return new ManifestInfo(entries, directories, paths);
    }

    private void validateStagedEntries(ManifestInfo info, ArrayList<StagedEntry> staged,
                                       long manifestSize, long expanded) throws Exception {
        if (staged.size() != info.files.size()) throw new IOException("备份清单与 ZIP 文件不一致");
        Map<String, StagedEntry> map = new HashMap<>();
        for (StagedEntry entry : staged) {
            if (map.put(entry.path, entry) != null) throw new IOException("ZIP 文件重复");
        }
        long total = manifestSize;
        for (ManifestEntry entry : info.files) {
            StagedEntry actual = map.get(entry.path);
            if (actual == null || actual.size != entry.size || !entry.sha256.equals(actual.sha256)) {
                throw new IOException("备份文件 hash 或大小不匹配: " + entry.path);
            }
            total = addLimited(total, actual.size, MAX_ARCHIVE_BYTES);
        }
        if (total > MAX_ARCHIVE_BYTES || expanded > MAX_ARCHIVE_BYTES) throw new IOException("备份展开内容超过 2 GiB");
    }

    private void applyEmptyDirectories(List<String> directories, File knowledgeRoot, PathRegistry files) throws IOException {
        for (String directory : directories) {
            if ("knowledge".equals(directory)) continue;
            String relative = directory.substring("knowledge/".length());
            File target = childFile(knowledgeRoot, relative);
            if (!target.exists() && !target.mkdirs()) throw new IOException("无法创建空知识库目录");
            if (!target.isDirectory()) throw new IOException("空知识库目录路径无效");
        }
    }

    private StagedEntry findStaged(ArrayList<StagedEntry> staged, String path) throws IOException {
        for (StagedEntry entry : staged) if (entry.path.equals(path)) return entry;
        throw new IOException("恢复文件缺失: " + path);
    }

    private void rememberTicket(String ticket, File root, List<String> files, JSONObject manifest) throws Exception {
        JSONObject all = ticketStates();
        JSONObject state = new JSONObject().put("root", root.getCanonicalPath()).put("files", new JSONArray(files)).put("manifest", manifest);
        all.put(ticket, state);
        if (!context.getSharedPreferences(STATE_PREFS, Context.MODE_PRIVATE).edit()
                .putString("tickets", all.toString()).commit()) throw new IOException("无法记录恢复票据");
    }

    private JSONObject ticketStates() {
        try {
            return new JSONObject(context.getSharedPreferences(STATE_PREFS, Context.MODE_PRIVATE)
                    .getString("tickets", "{}"));
        } catch (JSONException e) {
            return new JSONObject();
        }
    }

    private void saveTicketStates(JSONObject states) throws IOException {
        if (!context.getSharedPreferences(STATE_PREFS, Context.MODE_PRIVATE).edit()
                .putString("tickets", states.toString()).commit()) throw new IOException("无法更新恢复票据");
    }

    private boolean isPrivateTicketFile(File file, String ticket) throws IOException {
        File canonical = file.getCanonicalFile();
        boolean media = isWithin(canonical, backgrounds) || isWithin(canonical, music);
        return media && canonical.getName().startsWith(ticket + "_") && !Files.isSymbolicLink(canonical.toPath());
    }

    private boolean isPrivateRestoredRoot(File root, String ticket) throws IOException {
        File restored = new File(filesRoot, "restored").getCanonicalFile();
        return isWithin(root, restored) && root.equals(new File(restored, ticket).getCanonicalFile());
    }

    private String displayName(Uri uri) {
        try (Cursor cursor = resolver.query(uri, new String[]{OpenableColumns.DISPLAY_NAME}, null, null, null)) {
            if (cursor != null && cursor.moveToFirst()) return cursor.getString(0);
        } catch (Exception ignored) {
        }
        return "心海共学备份.xinhai-backup";
    }

    private static void putBytes(ZipOutputStream zip, String name, byte[] bytes) throws IOException {
        zip.putNextEntry(new ZipEntry(name));
        zip.write(bytes);
        zip.closeEntry();
    }

    private DigestResult copySource(SourceFile source, OutputStream out, long limit) throws Exception {
        source.verifyUnchanged(resolver);
        MessageDigest digest = MessageDigest.getInstance("SHA-256");
        long total = 0L;
        try (InputStream in = source.open(resolver)) {
            byte[] buffer = new byte[64 * 1024];
            int count;
            while ((count = in.read(buffer)) != -1) {
                total = addLimited(total, count, limit);
                digest.update(buffer, 0, count);
                out.write(buffer, 0, count);
            }
        }
        source.verifyUnchanged(resolver);
        return new DigestResult(total, hex(digest.digest()));
    }

    private DigestResult digestLocal(File file, long limit) throws Exception {
        if (Files.isSymbolicLink(file.toPath()) || !file.isFile()) throw new IOException("恢复文件不可读取");
        MessageDigest digest = MessageDigest.getInstance("SHA-256");
        long total = 0L;
        try (InputStream in = new FileInputStream(file)) {
            byte[] buffer = new byte[64 * 1024];
            int count;
            while ((count = in.read(buffer)) != -1) {
                total = addLimited(total, count, limit);
                digest.update(buffer, 0, count);
            }
        }
        return new DigestResult(total, hex(digest.digest()));
    }

    private DigestResult copyToFile(InputStream in, File file, long limit, long[] expanded) throws Exception {
        File parent = file.getParentFile();
        if (!parent.exists() && !parent.mkdirs()) throw new IOException("无法创建备份临时目录");
        try (OutputStream out = new FileOutputStream(file)) {
            return copyLimited(in, out, limit, expanded);
        } catch (Exception e) {
            deleteQuietly(file);
            throw e;
        }
    }

    private DigestResult copyLimited(InputStream in, OutputStream out, long limit, long[] expanded) throws Exception {
        MessageDigest digest = MessageDigest.getInstance("SHA-256");
        long total = 0L;
        byte[] buffer = new byte[64 * 1024];
        int count;
        while ((count = in.read(buffer)) != -1) {
            total = addLimited(total, count, limit);
            if (expanded != null) expanded[0] = addLimited(expanded[0], count, MAX_ARCHIVE_BYTES);
            digest.update(buffer, 0, count);
            out.write(buffer, 0, count);
        }
        return new DigestResult(total, hex(digest.digest()));
    }

    private byte[] readBytes(InputStream in, long limit, long[] expanded) throws Exception {
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        copyLimited(in, out, limit, expanded);
        return out.toByteArray();
    }

    private byte[] readFile(File file, long limit) throws Exception {
        try (InputStream in = new FileInputStream(file)) {
            ByteArrayOutputStream out = new ByteArrayOutputStream();
            copyLimited(in, out, limit, null);
            return out.toByteArray();
        }
    }

    private static long addLimited(long value, long increment, long limit) throws IOException {
        if (increment < 0 || value > limit - increment) throw new IOException("备份内容超过大小限制");
        return value + increment;
    }

    private static String decode(byte[] bytes, String label) throws IOException {
        try {
            return StandardCharsets.UTF_8.newDecoder().onMalformedInput(CodingErrorAction.REPORT)
                    .onUnmappableCharacter(CodingErrorAction.REPORT)
                    .decode(java.nio.ByteBuffer.wrap(bytes)).toString();
        } catch (CharacterCodingException e) {
            throw new IOException(label + " 不是有效 UTF-8", e);
        }
    }

    private static JSONObject parseJson(byte[] bytes, String label) throws IOException {
        try {
            return new JSONObject(decode(bytes, label));
        } catch (JSONException e) {
            throw new IOException(label + " 不是有效 JSON", e);
        }
    }

    private static void checkExact(JSONObject value, String... keys) throws IOException {
        Set<String> expected = new HashSet<>(Arrays.asList(keys));
        Set<String> actual = new HashSet<>();
        Iterator<String> iterator = value.keys();
        while (iterator.hasNext()) actual.add(iterator.next());
        if (!expected.equals(actual)) throw new IOException("备份字段不匹配");
    }

    private static long number(Object value, String label) throws IOException {
        if (!(value instanceof Number)) throw new IOException(label + "无效");
        double number = ((Number) value).doubleValue();
        if (number < 0 || number != Math.rint(number) || number > Long.MAX_VALUE) throw new IOException(label + "无效");
        return ((Number) value).longValue();
    }

    private static String lowerExtension(String value) throws IOException {
        if (value == null) throw new IOException("扩展名为空");
        String name = value.toLowerCase(Locale.ROOT);
        int dot = name.lastIndexOf('.');
        return dot >= 0 ? name.substring(dot + 1) : name;
    }

    private static String extensionFromPath(String value) throws IOException {
        int dot = value.lastIndexOf('.');
        if (dot <= 0 || dot == value.length() - 1) throw new IOException("文件扩展名无效");
        return value.substring(dot + 1).toLowerCase(Locale.ROOT);
    }

    private static boolean extensionAllowed(String kind, String extension) {
        return "music".equals(kind) ? MUSIC_EXTENSIONS.contains(extension)
                : "wallpaper".equals(kind) && WALLPAPER_EXTENSIONS.contains(extension);
    }

    private static boolean mediaNameMatchesId(String name, String id) throws IOException {
        String base = name.substring(0, name.lastIndexOf('.'));
        return base.equals(id) || base.matches("[0-9a-fA-F-]{36}_" + Pattern.quote(id));
    }

    private static void validateRelativePath(String value) throws IOException {
        if (value == null || value.isEmpty() || value.startsWith("/") || value.endsWith("/") || value.contains("\\") || value.indexOf('\u0000') >= 0) {
            throw new IOException("备份路径无效");
        }
        String[] parts = value.split("/", -1);
        for (String part : parts) validateSegment(part);
    }

    private static void validateSegment(String value) throws IOException {
        if (value == null || value.isEmpty() || value.equals(".") || value.equals("..") || value.length() > 255
                || value.endsWith(".") || value.endsWith(" ")) throw new IOException("备份路径片段无效");
        for (int i = 0; i < value.length(); i++) {
            char c = value.charAt(i);
            if (c < 0x20 || c == '<' || c == '>' || c == ':' || c == '"' || c == '/' || c == '\\' || c == '|' || c == '?' || c == '*') {
                throw new IOException("备份路径包含非法字符");
            }
        }
        String base = value;
        int dot = base.indexOf('.');
        if (dot >= 0) base = base.substring(0, dot);
        String upper = base.toUpperCase(Locale.ROOT);
        if (Arrays.asList("CON", "PRN", "AUX", "NUL", "COM1", "COM2", "COM3", "COM4", "COM5", "COM6", "COM7", "COM8", "COM9", "LPT1", "LPT2", "LPT3", "LPT4", "LPT5", "LPT6", "LPT7", "LPT8", "LPT9").contains(upper)) {
            throw new IOException("备份路径包含 Windows 保留名称");
        }
    }

    private static File childFile(File root, String relative) throws IOException {
        validateRelativePath(relative);
        File file = new File(root, relative).getCanonicalFile();
        if (!isWithin(file, root.getCanonicalFile())) throw new IOException("备份路径越界");
        return file;
    }

    private static boolean isWithin(File child, File root) throws IOException {
        String childPath = child.getCanonicalPath();
        String rootPath = root.getCanonicalPath();
        return childPath.startsWith(rootPath + File.separator);
    }

    private static String hex(byte[] bytes) {
        StringBuilder value = new StringBuilder(bytes.length * 2);
        for (byte b : bytes) value.append(String.format(Locale.ROOT, "%02x", b & 0xff));
        return value.toString();
    }

    private static void deleteQuietly(File file) {
        if (file == null || !file.exists()) return;
        File[] children = file.listFiles();
        if (children != null) for (File child : children) deleteQuietly(child);
        file.delete();
    }

    private static final class PathRegistry {
        private final Set<String> values = new HashSet<>();
        void add(String path) throws IOException {
            if (path == null || path.isEmpty()) throw new IOException("备份路径为空");
            String normalized = Normalizer.normalize(path, Normalizer.Form.NFC).toLowerCase(Locale.ROOT);
            if (!values.add(normalized)) throw new IOException("备份路径大小写或 NFC 冲突: " + path);
        }
        boolean contains(String path) {
            return values.contains(Normalizer.normalize(path, Normalizer.Form.NFC).toLowerCase(Locale.ROOT));
        }
    }

    private static final class SourceFile {
        final File file;
        final Uri uri;
        final long size;
        final long modified;
        private SourceFile(File file, Uri uri, long size, long modified) {
            this.file = file; this.uri = uri; this.size = size; this.modified = modified;
        }
        static SourceFile local(File file) throws IOException {
            File canonical = file.getCanonicalFile();
            return new SourceFile(canonical, null, canonical.length(), canonical.lastModified());
        }
        static SourceFile saf(Uri uri, long size, long modified) { return new SourceFile(null, uri, size, modified); }
        InputStream open(ContentResolver resolver) throws IOException {
            if (file != null) {
                if (Files.isSymbolicLink(file.toPath()) || !file.isFile()) throw new IOException("备份源文件不可读取");
                return new FileInputStream(file);
            }
            InputStream input = resolver.openInputStream(uri);
            if (input == null) throw new IOException("备份源文件不可读取");
            return input;
        }
        void verifyUnchanged(ContentResolver resolver) throws IOException {
            if (file != null) {
                if (Files.isSymbolicLink(file.toPath()) || !file.isFile() || file.length() != size || file.lastModified() != modified) {
                    throw new IOException("备份源文件在读取期间发生变化");
                }
                return;
            }
            long currentSize = -1L, currentModified = -1L;
            try (Cursor cursor = resolver.query(uri, new String[]{OpenableColumns.SIZE, DocumentsContract.Document.COLUMN_LAST_MODIFIED}, null, null, null)) {
                if (cursor == null || !cursor.moveToFirst()) throw new IOException("无法验证 SAF 文件");
                if (!cursor.isNull(0)) currentSize = cursor.getLong(0);
                if (!cursor.isNull(1)) currentModified = cursor.getLong(1);
            }
            if (size >= 0 && currentSize >= 0 && size != currentSize) throw new IOException("SAF 文件大小发生变化");
            if (modified >= 0 && currentModified >= 0 && modified != currentModified) throw new IOException("SAF 文件发生变化");
        }
    }

    private static final class ArchiveEntry {
        final String path, kind, id;
        final byte[] bytes;
        final SourceFile source;
        long size;
        String sha256;
        private ArchiveEntry(String path, String kind, String id, byte[] bytes, SourceFile source) {
            this.path = path; this.kind = kind; this.id = id; this.bytes = bytes; this.source = source;
        }
        static ArchiveEntry bytes(String path, String kind, byte[] bytes, String id) { return new ArchiveEntry(path, kind, id, bytes, null); }
        static ArchiveEntry source(String path, String kind, String id, SourceFile source) { return new ArchiveEntry(path, kind, id, null, source); }
        void prepareHash(ContentResolver resolver) throws Exception {
            if (bytes != null) { size = bytes.length; sha256 = hex(MessageDigest.getInstance("SHA-256").digest(bytes)); }
            else { DigestResult result = digestSource(source, resolver); size = result.size; sha256 = result.sha256; }
        }
        private static DigestResult digestSource(SourceFile source, ContentResolver resolver) throws Exception {
            MessageDigest digest = MessageDigest.getInstance("SHA-256");
            source.verifyUnchanged(resolver);
            long total = 0L;
            try (InputStream in = source.open(resolver)) {
                byte[] buffer = new byte[64 * 1024]; int count;
                while ((count = in.read(buffer)) != -1) { total = addLimited(total, count, MAX_FILE_BYTES); digest.update(buffer, 0, count); }
            }
            source.verifyUnchanged(resolver);
            return new DigestResult(total, hex(digest.digest()));
        }
    }

    private static final class DigestResult { final long size; final String sha256; DigestResult(long size, String sha256) { this.size = size; this.sha256 = sha256; } }
    private static final class StagedEntry { final String path, kind, id; final File file; final long size; final String sha256; StagedEntry(String path, String kind, String id, File file, long size, String sha256) { this.path = path; this.kind = kind; this.id = id; this.file = file; this.size = size; this.sha256 = sha256; } }
    private static final class ManifestEntry { final String path, kind, id, sha256; final long size; ManifestEntry(String path, String kind, String id, long size, String sha256) { this.path = path; this.kind = kind; this.id = id; this.size = size; this.sha256 = sha256; } }
    private static final class ManifestInfo { final ArrayList<ManifestEntry> files; final ArrayList<String> directories; final PathRegistry filePaths; ManifestInfo(ArrayList<ManifestEntry> files, ArrayList<String> directories, PathRegistry filePaths) { this.files = files; this.directories = directories; this.filePaths = filePaths; } }
    private static final class SafChild { final String id, name, mime; final long size, modified; SafChild(String id, String name, String mime, long size, long modified) { this.id = id; this.name = name; this.mime = mime; this.size = size; this.modified = modified; } }

    private static final class CountingInputStream extends InputStream {
        final InputStream input; final long limit; long count;
        CountingInputStream(InputStream input, long limit) { this.input = input; this.limit = limit; }
        private int counted(int value) throws IOException { if (value >= 0) { count = addLimited(count, 1, limit); } return value; }
        @Override public int read() throws IOException { return counted(input.read()); }
        @Override public int read(byte[] buffer, int offset, int length) throws IOException { int n = input.read(buffer, offset, length); if (n > 0) count = addLimited(count, n, limit); return n; }
        @Override public void close() throws IOException { input.close(); }
    }

    private static final class LimitedOutputStream extends FilterOutputStream {
        final long limit; long count;
        LimitedOutputStream(OutputStream output, long limit) { super(output); this.limit = limit; }
        @Override public void write(int value) throws IOException { count = addLimited(count, 1, limit); out.write(value); }
        @Override public void write(byte[] buffer, int offset, int length) throws IOException { count = addLimited(count, length, limit); out.write(buffer, offset, length); }
    }
}
