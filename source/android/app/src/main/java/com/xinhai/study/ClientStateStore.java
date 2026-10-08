package com.xinhai.study;

import android.content.ContentValues;
import android.database.Cursor;
import android.database.sqlite.SQLiteDatabase;
import android.database.sqlite.SQLiteException;
import org.json.JSONException;
import org.json.JSONObject;
import java.util.Arrays;
import java.util.Collections;
import java.util.HashSet;
import java.util.Set;

/** Durable mirror for the allowlisted WebView client-state keys. */
final class ClientStateStore {
    private static final String TABLE = "mobile_client_state";
    private static final String META_TABLE = "mobile_client_state_meta";
    private static final String INITIALIZED_KEY = "initialized";
    private static final String INITIALIZED_VALUE = "1";
    private static final String KEY_COLUMN = "key";
    private static final String VALUE_COLUMN = "value";
    private static final String CHARS_COLUMN = "chars";
    private static final int MAX_KEY_CHARS = 6_000;
    private static final int MAX_VALUE_CHARS = 8 * 1024 * 1024;
    private static final int MAX_TOTAL_CHARS = 10 * 1024 * 1024;
    private static final int VALUE_CHUNK_CODEPOINTS = 128 * 1024;

    // Keep this list in sync with src/shared/backupDatabase.ts:isBackupClientKey.
    private static final Set<String> EXACT_KEYS = Collections.unmodifiableSet(new HashSet<>(Arrays.asList(
        "xinhai-journal-draft-v1",
        "xinhai-review-draft-v1",
        "xinhai-focus-tasks-v1",
        "xinhai-music-prefs",
        "xinhai-music-resume",
        "xinhai-netease-library-v1",
        "xinhai-netease-shares-v1",
        "wallpaper-gesture-learned"
    )));

    private final SQLiteDatabase database;
    private boolean schemaReady;

    ClientStateStore(SQLiteDatabase database) {
        if (database == null) throw new IllegalArgumentException("客户端存储数据库不能为空");
        this.database = database;
    }

    /** Migrates the browser copy once, then always returns the native authoritative state. */
    synchronized JSONObject initialize(JSONObject browserState) throws JSONException {
        requireOutsideTransaction();
        if (browserState == null) throw new IllegalArgumentException("客户端存储初始化数据无效");
        ensureSchema();
        requireOutsideTransaction();
        database.beginTransaction();
        try {
            String initialized = readMarker();
            if (INITIALIZED_VALUE.equals(initialized)) {
                JSONObject nativeState = readAll();
                database.setTransactionSuccessful();
                return nativeState;
            }
            if (initialized != null) throw new IllegalStateException("客户端存储初始化标记损坏");

            validateObject(browserState);
            database.delete(TABLE, null, null);
            for (String key : keys(browserState)) insert(key, browserState.getString(key));
            putMarker();
            JSONObject nativeState = readAll();
            database.setTransactionSuccessful();
            return nativeState;
        } finally {
            database.endTransaction();
        }
    }

    synchronized void set(String key, String value) {
        requireOutsideTransaction();
        validateEntry(key, value);
        ensureSchema();
        requireOutsideTransaction();
        database.beginTransaction();
        try {
            requireInitialized();
            Integer previousChars = readStoredChars(key);
            if (valueMatches(key, value)) {
                database.setTransactionSuccessful();
                return;
            }
            long total = totalChars();
            if (previousChars != null) total -= previousChars;
            total += key.length() + value.length();
            if (total > MAX_TOTAL_CHARS) throw new IllegalArgumentException("客户端存储超过 10 Mi 字符限制");

            ContentValues row = new ContentValues();
            row.put(KEY_COLUMN, key);
            row.put(VALUE_COLUMN, value);
            row.put(CHARS_COLUMN, key.length() + value.length());
            if (previousChars == null) {
                if (database.insert(TABLE, null, row) < 0) throw new SQLiteException("保存客户端状态失败");
            } else if (database.update(TABLE, row, "\"key\" = ?", new String[]{key}) != 1) {
                throw new SQLiteException("更新客户端状态失败");
            }
            database.setTransactionSuccessful();
        } finally {
            database.endTransaction();
        }
    }

    synchronized void remove(String key) {
        requireOutsideTransaction();
        validateKey(key);
        ensureSchema();
        requireOutsideTransaction();
        database.beginTransaction();
        try {
            requireInitialized();
            database.delete(TABLE, "\"key\" = ?", new String[]{key});
            database.setTransactionSuccessful();
        } finally {
            database.endTransaction();
        }
    }

    synchronized void clear() {
        ensureReadyForMutation();
        database.beginTransaction();
        try {
            requireInitialized();
            // The table contains only keys accepted by validateKey; keep the one-time marker.
            database.delete(TABLE, null, null);
            database.setTransactionSuccessful();
        } finally {
            database.endTransaction();
        }
    }

    private void ensureReadyForMutation() {
        requireOutsideTransaction();
        ensureSchema();
        requireOutsideTransaction();
    }

    private void requireOutsideTransaction() {
        if (database.inTransaction()) throw new IllegalStateException("客户端存储不能加入正在进行的数据库事务");
    }

    private void ensureSchema() {
        if (schemaReady) return;
        synchronized (database) {
            requireOutsideTransaction();
            if (schemaReady) return;
            database.execSQL("CREATE TABLE IF NOT EXISTS \"" + TABLE + "\" (\"key\" TEXT PRIMARY KEY NOT NULL, \"value\" TEXT NOT NULL, \"chars\" INTEGER NOT NULL)");
            database.execSQL("CREATE TABLE IF NOT EXISTS \"" + META_TABLE + "\" (\"key\" TEXT PRIMARY KEY NOT NULL, \"value\" TEXT NOT NULL)");
            schemaReady = true;
        }
    }

    private void validateObject(JSONObject state) throws JSONException {
        long total = 0;
        for (String key : keys(state)) {
            Object raw = state.get(key);
            if (!(raw instanceof String)) throw new IllegalArgumentException("客户端状态值必须是字符串");
            String value = (String) raw;
            validateEntry(key, value);
            total += key.length() + value.length();
            if (total > MAX_TOTAL_CHARS) throw new IllegalArgumentException("客户端存储超过 10 Mi 字符限制");
        }
    }

    private static Set<String> keys(JSONObject state) {
        Set<String> result = new HashSet<>();
        java.util.Iterator<String> iterator = state.keys();
        while (iterator.hasNext()) result.add(iterator.next());
        return result;
    }

    private static boolean allowed(String key) {
        return EXACT_KEYS.contains(key) || key.startsWith("xinhai-note:");
    }

    private static void validateKey(String key) {
        if (key == null || !allowed(key) || key.length() > MAX_KEY_CHARS) {
            throw new IllegalArgumentException("客户端状态键不受支持");
        }
    }

    private static void validateEntry(String key, String value) {
        validateKey(key);
        if (value == null) throw new IllegalArgumentException("客户端状态值必须是字符串");
        if (value.length() > MAX_VALUE_CHARS) throw new IllegalArgumentException("单项客户端状态超过 8 Mi 字符限制");
    }

    private void insert(String key, String value) {
        ContentValues row = new ContentValues();
        row.put(KEY_COLUMN, key);
        row.put(VALUE_COLUMN, value);
        row.put(CHARS_COLUMN, key.length() + value.length());
        if (database.insert(TABLE, null, row) < 0) throw new SQLiteException("迁移客户端状态失败");
    }

    private void putMarker() {
        ContentValues marker = new ContentValues();
        marker.put(KEY_COLUMN, INITIALIZED_KEY);
        marker.put(VALUE_COLUMN, INITIALIZED_VALUE);
        if (database.insert(META_TABLE, null, marker) < 0) throw new SQLiteException("记录客户端存储初始化状态失败");
    }

    private String readMarker() {
        try (Cursor cursor = database.query(META_TABLE, new String[]{VALUE_COLUMN}, "\"key\" = ?", new String[]{INITIALIZED_KEY}, null, null, null)) {
            return cursor.moveToFirst() ? cursor.getString(0) : null;
        }
    }

    private void requireInitialized() {
        if (!INITIALIZED_VALUE.equals(readMarker())) throw new IllegalStateException("客户端存储尚未完成初始化");
    }

    private Integer readStoredChars(String key) {
        try (Cursor cursor = database.query(TABLE, new String[]{CHARS_COLUMN}, "\"key\" = ?", new String[]{key}, null, null, null)) {
            return cursor.moveToFirst() ? cursor.getInt(0) : null;
        }
    }

    private boolean valueMatches(String key, String value) {
        String sql = "SELECT 1 FROM \"" + TABLE + "\" WHERE \"key\" = ? AND \"value\" = ? LIMIT 1";
        try (Cursor cursor = database.rawQuery(sql, new String[]{key, value})) {
            return cursor.moveToFirst();
        }
    }

    private long totalChars() {
        String sql = "SELECT COALESCE(SUM(\"" + CHARS_COLUMN + "\"), 0) FROM \"" + TABLE + "\"";
        try (Cursor cursor = database.rawQuery(sql, null)) {
            return cursor.moveToFirst() ? cursor.getLong(0) : 0;
        }
    }

    private JSONObject readAll() throws JSONException {
        JSONObject result = new JSONObject();
        long total = 0;
        try (Cursor cursor = database.query(TABLE, new String[]{KEY_COLUMN, CHARS_COLUMN}, null, null, null, null, null)) {
            while (cursor.moveToNext()) {
                String key = cursor.getString(0);
                int chars = cursor.getInt(1);
                String value = readValueInChunks(key, chars - key.length());
                validateEntry(key, value);
                total += key.length() + value.length();
                if (total > MAX_TOTAL_CHARS || key.length() + value.length() != chars) {
                    throw new IllegalStateException("客户端存储计数无效");
                }
                result.put(key, value);
            }
        }
        return result;
    }

    private String readValueInChunks(String key, int expectedUtf16Chars) {
        if (expectedUtf16Chars < 0 || expectedUtf16Chars > MAX_VALUE_CHARS) throw new IllegalStateException("客户端状态计数无效");
        String sql = "SELECT substr(\"" + VALUE_COLUMN + "\", ?, ?) FROM \"" + TABLE + "\" WHERE \"key\" = ?";
        StringBuilder value = new StringBuilder(expectedUtf16Chars);
        int offset = 1;
        while (value.length() < expectedUtf16Chars) {
            String chunk;
            try (Cursor cursor = database.rawQuery(sql, new String[]{String.valueOf(offset), String.valueOf(VALUE_CHUNK_CODEPOINTS), key})) {
                if (!cursor.moveToFirst()) throw new IllegalStateException("客户端状态记录缺失");
                chunk = cursor.getString(0);
            }
            if (chunk == null || chunk.isEmpty()) throw new IllegalStateException("客户端状态分块读取不完整");
            value.append(chunk);
            offset += VALUE_CHUNK_CODEPOINTS;
        }
        if (value.length() != expectedUtf16Chars) throw new IllegalStateException("客户端状态分块计数不匹配");
        return value.toString();
    }
}
