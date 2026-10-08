package com.xinhai.study;

import java.util.ArrayList;
import java.util.Arrays;
import java.util.Collections;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * Fixed SQL catalog for the mobile database bridge.
 *
 * Values are always supplied through SQLite bind arguments by sqlite.ts. This
 * class therefore validates only the statement shape and local identifiers;
 * it deliberately has no API for interpolating runtime data into SQL.
 */
public final class SqlBridgePolicy {
    private static final int MAX_SQL_LENGTH = 64 * 1024;
    private static final Pattern IDENT = Pattern.compile("[A-Z_][A-Z0-9_]*");
    private static final Pattern INSERT = Pattern.compile("^INSERT(?: OR (?:IGNORE|REPLACE))? INTO ([A-Z_][A-Z0-9_]*)\\s*\\(([^()]*)\\) VALUES \\(([^()]*)\\)$");
    private static final Pattern UPDATE = Pattern.compile("^UPDATE ([A-Z_][A-Z0-9_]*) SET (.+?)(?: WHERE (.+))?$");
    private static final Pattern DELETE = Pattern.compile("^DELETE FROM ([A-Z_][A-Z0-9_]*)(?: WHERE (.+))?$");
    private static final Pattern SELECT_STAR = Pattern.compile("^SELECT \\* FROM ([A-Z_][A-Z0-9_]*)(.*)$");
    private static final Pattern SELECT_COLUMNS = Pattern.compile("^SELECT (.+?) FROM ([A-Z_][A-Z0-9_]*)(.*)$");
    private static final Pattern COUNT = Pattern.compile("^SELECT COUNT\\(\\*\\) AS N FROM ([A-Z_][A-Z0-9_]*)(.*)$");

    private static final Set<String> TABLES;
    private static final Set<String> BACKUP_TABLES;
    private static final Set<String> RUN_CLEAR_TABLES = set("STATS", "GROWTH_EVENTS", "FOCUS_SESSIONS", "JOURNALS", "SETTINGS", "TODOS", "HABITS", "HABIT_LOGS", "EVENTS", "FOCUS_COMMITS", "JOURNAL_COMMITS", "GROWTH_META", "GROWTH_RESETS", "REVIEW_CARDS", "REVIEW_LOGS", "MUSIC_IMPORTS", "FOCUS_RECOVERY", "SYNC_META", "SYNC_ROWS", "SYNC_CONFLICTS", "SYNC_BACKUPS");
    private static final Set<String> SYNC_BUSINESS_TABLES = set("HABITS", "TODOS", "FOCUS_SESSIONS", "JOURNALS", "EVENTS", "REVIEW_CARDS", "HABIT_LOGS", "REVIEW_LOGS", "GROWTH_EVENTS");
    private static final Set<String> EXEC_CLEAR_TABLES = set("FOCUS_SESSIONS", "JOURNALS", "HABIT_LOGS", "TODOS", "REVIEW_CARDS", "REVIEW_LOGS");
    private static final Map<String, Set<String>> COLUMNS;
    private static final Map<String, Set<String>> INSERT_COLUMNS;
    private static final Set<String> DDL_PATTERNS = new HashSet<>();
    private static final Set<String> EXACT_QUERIES = new HashSet<>();

    static {
        Set<String> tables = new HashSet<>(Arrays.asList(
                "APP_MIGRATIONS", "JOURNAL_COMMITS", "STATS", "GROWTH_EVENTS",
                "FOCUS_SESSIONS", "JOURNALS", "SETTINGS", "TODOS", "HABITS",
                "HABIT_LOGS", "EVENTS", "FOCUS_COMMITS", "GROWTH_META",
                "GROWTH_RESETS", "REVIEW_CARDS", "REVIEW_LOGS", "MUSIC_IMPORTS",
                "FOCUS_RECOVERY", "PENDING_CLIENT_RESTORE", "DEVICE_RESOURCES",
                "SYNC_META", "SYNC_ROWS", "SYNC_CONFLICTS", "SYNC_BACKUPS",
                "SQLITE_SEQUENCE"));
        TABLES = Collections.unmodifiableSet(tables);
        Set<String> backups = new HashSet<>(Arrays.asList(
                "STATS", "GROWTH_EVENTS", "FOCUS_SESSIONS", "JOURNALS", "SETTINGS",
                "TODOS", "HABITS", "HABIT_LOGS", "EVENTS", "FOCUS_COMMITS",
                "JOURNAL_COMMITS", "GROWTH_META", "GROWTH_RESETS", "REVIEW_CARDS",
                "REVIEW_LOGS", "MUSIC_IMPORTS", "FOCUS_RECOVERY"));
        BACKUP_TABLES = Collections.unmodifiableSet(backups);

        Map<String, Set<String>> columns = new HashMap<>();
        columns.put("APP_MIGRATIONS", set("KEY", "VALUE"));
        columns.put("JOURNAL_COMMITS", set("TOKEN", "RESULT_JSON"));
        columns.put("STATS", set("ID", "POINTS_JSON"));
        columns.put("GROWTH_EVENTS", set("ID", "TS", "DIMENSION", "POINTS", "SOURCE", "REASON", "SYNC_CAUSE"));
        columns.put("FOCUS_SESSIONS", set("ID", "STARTED_AT", "ENDED_AT", "MINUTES", "SECONDS", "MODE", "TASK_LABEL", "SYNC_TOKEN"));
        columns.put("JOURNALS", set("ID", "TS", "CONTENT", "SCORES_JSON", "SUMMARY", "ENGINE"));
        columns.put("SETTINGS", set("ID", "JSON"));
        columns.put("TODOS", set("ID", "TITLE", "PRIORITY", "DATE", "EST_POMOS", "DONE", "FOCUS_MINUTES", "CREATED_AT", "COMPLETED_AT"));
        columns.put("HABITS", set("ID", "NAME", "DIMENSION", "WEEKLY_TARGET", "SORT_ORDER", "DELETED_AT"));
        columns.put("HABIT_LOGS", set("ID", "HABIT_ID", "DATE", "TS"));
        columns.put("EVENTS", set("ID", "TITLE", "DATE", "KIND"));
        columns.put("FOCUS_COMMITS", set("TOKEN", "RESULT_JSON"));
        columns.put("GROWTH_META", set("ID", "EPOCH"));
        columns.put("GROWTH_RESETS", set("ID", "TS", "STATS_JSON", "EVENTS_JSON", "UNDONE", "PRACTICE_JSON"));
        columns.put("REVIEW_CARDS", set("ID", "QUESTION", "ANSWER", "TOPIC", "SOURCEROOT", "SOURCEPATH", "DUEDATE", "INTERVALDAYS", "REVIEWS", "ARCHIVED", "VERSION", "CREATEDAT", "UPDATEDAT"));
        columns.put("REVIEW_LOGS", set("TOKEN", "CARDID", "RATING", "TS", "PREVIOUSDUE", "NEXTDUE", "INTERVALDAYS"));
        columns.put("MUSIC_IMPORTS", set("ID", "PATH", "TITLE", "CREATEDAT"));
        columns.put("FOCUS_RECOVERY", set("ID", "TOKEN", "BODY", "UPDATED_AT"));
        columns.put("PENDING_CLIENT_RESTORE", set("ID", "BODY", "TOKEN"));
        columns.put("DEVICE_RESOURCES", set("KEY", "VALUE"));
        columns.put("SYNC_META", set("KEY", "VALUE"));
        columns.put("SYNC_ROWS", set("TABLE_NAME", "UID", "LOCAL_ID", "DOC_JSON", "SNAPSHOT_JSON"));
        columns.put("SYNC_CONFLICTS", set("ID", "DETAIL"));
        columns.put("SYNC_BACKUPS", set("ID", "TS", "BODY"));
        columns.put("SQLITE_SEQUENCE", set("NAME", "SEQ"));
        COLUMNS = Collections.unmodifiableMap(columns);

        Map<String, Set<String>> inserts = new HashMap<>();
        insert(inserts, "APP_MIGRATIONS", "KEY,VALUE");
        insert(inserts, "JOURNAL_COMMITS", "TOKEN,RESULT_JSON");
        insert(inserts, "STATS", "ID,POINTS_JSON");
        insert(inserts, "GROWTH_EVENTS", "TS,DIMENSION,POINTS,SOURCE,REASON,SYNC_CAUSE");
        insert(inserts, "GROWTH_EVENTS", "ID,TS,DIMENSION,POINTS,SOURCE,REASON");
        insert(inserts, "GROWTH_EVENTS", "ID,TS,DIMENSION,POINTS,SOURCE,REASON,SYNC_CAUSE");
        insert(inserts, "FOCUS_SESSIONS", "STARTED_AT,ENDED_AT,MINUTES,MODE,TASK_LABEL");
        insert(inserts, "FOCUS_SESSIONS", "ID,STARTED_AT,ENDED_AT,MINUTES,MODE,TASK_LABEL,SECONDS,SYNC_TOKEN");
        insert(inserts, "FOCUS_SESSIONS", "ID,STARTED_AT,ENDED_AT,MINUTES,SECONDS,MODE,TASK_LABEL,SYNC_TOKEN");
        insert(inserts, "JOURNALS", "TS,CONTENT,SCORES_JSON,SUMMARY,ENGINE");
        insert(inserts, "JOURNALS", "ID,TS,CONTENT,SCORES_JSON,SUMMARY,ENGINE");
        insert(inserts, "SETTINGS", "ID,JSON");
        insert(inserts, "TODOS", "TITLE,PRIORITY,DATE,EST_POMOS,DONE,FOCUS_MINUTES,CREATED_AT");
        insert(inserts, "TODOS", "ID,TITLE,PRIORITY,DATE,EST_POMOS,DONE,FOCUS_MINUTES,CREATED_AT,COMPLETED_AT");
        insert(inserts, "HABITS", "NAME,DIMENSION,WEEKLY_TARGET,SORT_ORDER");
        insert(inserts, "HABITS", "ID,NAME,DIMENSION,WEEKLY_TARGET,SORT_ORDER,DELETED_AT");
        insert(inserts, "HABIT_LOGS", "HABIT_ID,DATE,TS");
        insert(inserts, "HABIT_LOGS", "ID,HABIT_ID,DATE,TS");
        insert(inserts, "EVENTS", "TITLE,DATE,KIND");
        insert(inserts, "EVENTS", "ID,TITLE,DATE,KIND");
        insert(inserts, "FOCUS_COMMITS", "TOKEN,RESULT_JSON");
        insert(inserts, "GROWTH_META", "ID,EPOCH");
        insert(inserts, "GROWTH_RESETS", "TS,STATS_JSON,EVENTS_JSON,PRACTICE_JSON");
        insert(inserts, "GROWTH_RESETS", "ID,TS,STATS_JSON,EVENTS_JSON,UNDONE,PRACTICE_JSON");
        insert(inserts, "REVIEW_CARDS", "ID,QUESTION,ANSWER,TOPIC,SOURCEROOT,SOURCEPATH,DUEDATE,CREATEDAT,UPDATEDAT");
        insert(inserts, "REVIEW_CARDS", "ID,QUESTION,ANSWER,TOPIC,SOURCEPATH,DUEDATE,INTERVALDAYS,REVIEWS,ARCHIVED,CREATEDAT,UPDATEDAT");
        insert(inserts, "REVIEW_CARDS", "ID,QUESTION,ANSWER,TOPIC,SOURCEROOT,SOURCEPATH,DUEDATE,INTERVALDAYS,REVIEWS,ARCHIVED,VERSION,CREATEDAT,UPDATEDAT");
        insert(inserts, "REVIEW_LOGS", "TOKEN,CARDID,RATING,TS,PREVIOUSDUE,NEXTDUE,INTERVALDAYS");
        insert(inserts, "MUSIC_IMPORTS", "ID,PATH,TITLE,CREATEDAT");
        insert(inserts, "FOCUS_RECOVERY", "ID,TOKEN,BODY,UPDATED_AT");
        insert(inserts, "PENDING_CLIENT_RESTORE", "ID,BODY,TOKEN");
        insert(inserts, "DEVICE_RESOURCES", "KEY,VALUE");
        insert(inserts, "SYNC_META", "KEY,VALUE");
        insert(inserts, "SYNC_ROWS", "TABLE_NAME,UID,LOCAL_ID,DOC_JSON,SNAPSHOT_JSON");
        insert(inserts, "SYNC_CONFLICTS", "ID,DETAIL");
        insert(inserts, "SYNC_BACKUPS", "TS,BODY");
        insert(inserts, "SYNC_BACKUPS", "ID,TS,BODY");
        insert(inserts, "SQLITE_SEQUENCE", "NAME,SEQ");
        INSERT_COLUMNS = Collections.unmodifiableMap(inserts);

        Collections.addAll(DDL_PATTERNS,
                "CREATE TABLE IF NOT EXISTS APP_MIGRATIONS \\(KEY TEXT PRIMARY KEY, VALUE TEXT NOT NULL\\)",
                "CREATE TABLE IF NOT EXISTS JOURNAL_COMMITS \\(TOKEN TEXT PRIMARY KEY, RESULT_JSON TEXT NOT NULL\\)",
                "CREATE TABLE IF NOT EXISTS STATS \\(ID INTEGER PRIMARY KEY CHECK \\(ID = 1\\), POINTS_JSON TEXT NOT NULL\\)",
                "CREATE TABLE IF NOT EXISTS GROWTH_EVENTS \\(ID INTEGER PRIMARY KEY AUTOINCREMENT, TS INTEGER NOT NULL, DIMENSION TEXT NOT NULL, POINTS INTEGER NOT NULL, SOURCE TEXT NOT NULL, REASON TEXT NOT NULL DEFAULT ''\\)",
                "CREATE TABLE IF NOT EXISTS FOCUS_SESSIONS \\(ID INTEGER PRIMARY KEY AUTOINCREMENT, STARTED_AT INTEGER NOT NULL, ENDED_AT INTEGER NOT NULL, MINUTES INTEGER NOT NULL, MODE TEXT NOT NULL DEFAULT '', TASK_LABEL TEXT NOT NULL DEFAULT ''\\)",
                "CREATE TABLE IF NOT EXISTS JOURNALS \\(ID INTEGER PRIMARY KEY AUTOINCREMENT, TS INTEGER NOT NULL, CONTENT TEXT NOT NULL, SCORES_JSON TEXT NOT NULL, SUMMARY TEXT NOT NULL DEFAULT '', ENGINE TEXT NOT NULL DEFAULT 'LOCAL'\\)",
                "CREATE TABLE IF NOT EXISTS SETTINGS \\(ID INTEGER PRIMARY KEY CHECK \\(ID = 1\\), JSON TEXT NOT NULL\\)",
                "CREATE TABLE IF NOT EXISTS TODOS \\(ID INTEGER PRIMARY KEY AUTOINCREMENT, TITLE TEXT NOT NULL, PRIORITY INTEGER NOT NULL DEFAULT 1, DATE TEXT NOT NULL DEFAULT '', EST_POMOS INTEGER NOT NULL DEFAULT 1, DONE INTEGER NOT NULL DEFAULT 0, FOCUS_MINUTES INTEGER NOT NULL DEFAULT 0, CREATED_AT INTEGER NOT NULL\\)",
                "CREATE TABLE IF NOT EXISTS HABITS \\(ID INTEGER PRIMARY KEY AUTOINCREMENT, NAME TEXT NOT NULL, DIMENSION TEXT NOT NULL, WEEKLY_TARGET INTEGER NOT NULL DEFAULT 7\\)",
                "CREATE TABLE IF NOT EXISTS HABIT_LOGS \\(ID INTEGER PRIMARY KEY AUTOINCREMENT, HABIT_ID INTEGER NOT NULL, DATE TEXT NOT NULL, TS INTEGER NOT NULL\\)",
                "CREATE TABLE IF NOT EXISTS EVENTS \\(ID INTEGER PRIMARY KEY AUTOINCREMENT, TITLE TEXT NOT NULL, DATE TEXT NOT NULL, KIND TEXT NOT NULL DEFAULT '学习'\\)",
                "CREATE TABLE IF NOT EXISTS FOCUS_COMMITS \\(TOKEN TEXT PRIMARY KEY, RESULT_JSON TEXT NOT NULL\\)",
                "CREATE TABLE IF NOT EXISTS GROWTH_META \\(ID INTEGER PRIMARY KEY CHECK\\(ID=1\\), EPOCH INTEGER NOT NULL DEFAULT 0\\)",
                "CREATE TABLE IF NOT EXISTS GROWTH_RESETS \\(ID INTEGER PRIMARY KEY AUTOINCREMENT, TS INTEGER NOT NULL, STATS_JSON TEXT NOT NULL, EVENTS_JSON TEXT NOT NULL, UNDONE INTEGER NOT NULL DEFAULT 0\\)",
                "CREATE TABLE IF NOT EXISTS REVIEW_CARDS \\(ID TEXT PRIMARY KEY, QUESTION TEXT NOT NULL, ANSWER TEXT NOT NULL, TOPIC TEXT NOT NULL, SOURCEROOT TEXT NOT NULL, SOURCEPATH TEXT NOT NULL, DUEDATE TEXT NOT NULL, INTERVALDAYS INTEGER NOT NULL DEFAULT 0, REVIEWS INTEGER NOT NULL DEFAULT 0, ARCHIVED INTEGER NOT NULL DEFAULT 0, VERSION INTEGER NOT NULL DEFAULT 1, CREATEDAT INTEGER NOT NULL, UPDATEDAT INTEGER NOT NULL\\)",
                "CREATE TABLE IF NOT EXISTS REVIEW_LOGS \\(TOKEN TEXT PRIMARY KEY, CARDID TEXT NOT NULL, RATING TEXT NOT NULL, TS INTEGER NOT NULL, PREVIOUSDUE TEXT NOT NULL, NEXTDUE TEXT NOT NULL, INTERVALDAYS INTEGER NOT NULL\\)",
                "CREATE TABLE IF NOT EXISTS MUSIC_IMPORTS \\(ID TEXT PRIMARY KEY, PATH TEXT NOT NULL, TITLE TEXT NOT NULL, CREATEDAT INTEGER NOT NULL\\)",
                "CREATE TABLE IF NOT EXISTS FOCUS_RECOVERY \\(ID INTEGER PRIMARY KEY CHECK \\(ID = 1\\), TOKEN TEXT NOT NULL, BODY TEXT NOT NULL, UPDATED_AT INTEGER NOT NULL\\)",
                "CREATE TABLE IF NOT EXISTS PENDING_CLIENT_RESTORE \\(ID INTEGER PRIMARY KEY CHECK\\(ID=1\\), BODY TEXT NOT NULL\\)",
                "CREATE TABLE IF NOT EXISTS DEVICE_RESOURCES\\(KEY TEXT PRIMARY KEY, VALUE TEXT NOT NULL\\)",
                "CREATE TABLE IF NOT EXISTS SYNC_META\\(KEY TEXT PRIMARY KEY, VALUE TEXT NOT NULL\\)",
                "CREATE TABLE IF NOT EXISTS SYNC_ROWS\\(TABLE_NAME TEXT NOT NULL, UID TEXT NOT NULL, LOCAL_ID TEXT, DOC_JSON TEXT NOT NULL, SNAPSHOT_JSON TEXT NOT NULL, PRIMARY KEY\\(TABLE_NAME, UID\\), UNIQUE\\(TABLE_NAME, LOCAL_ID\\)\\)",
                "CREATE TABLE IF NOT EXISTS SYNC_CONFLICTS\\(ID TEXT PRIMARY KEY, DETAIL TEXT NOT NULL\\)",
                "CREATE TABLE IF NOT EXISTS SYNC_BACKUPS\\(ID INTEGER PRIMARY KEY AUTOINCREMENT, TS INTEGER NOT NULL, BODY TEXT NOT NULL\\)",
                "CREATE INDEX IF NOT EXISTS REVIEW_DUE ON REVIEW_CARDS\\(ARCHIVED,DUEDATE\\)",
                "ALTER TABLE HABITS ADD COLUMN SORT_ORDER INTEGER NOT NULL DEFAULT 0",
                "ALTER TABLE HABITS ADD COLUMN DELETED_AT INTEGER",
                "ALTER TABLE TODOS ADD COLUMN COMPLETED_AT INTEGER",
                "ALTER TABLE FOCUS_SESSIONS ADD COLUMN SECONDS INTEGER",
                "ALTER TABLE FOCUS_SESSIONS ADD COLUMN SYNC_TOKEN TEXT",
                "ALTER TABLE GROWTH_EVENTS ADD COLUMN SYNC_CAUSE TEXT",
                "ALTER TABLE GROWTH_RESETS ADD COLUMN PRACTICE_JSON TEXT",
                "ALTER TABLE PENDING_CLIENT_RESTORE ADD COLUMN TOKEN TEXT NOT NULL DEFAULT ''");

        Collections.addAll(EXACT_QUERIES,
                "SELECT L.HABIT_ID,L.DATE FROM HABIT_LOGS L JOIN HABITS H ON H.ID=L.HABIT_ID WHERE H.DIMENSION=? AND ? = ? || H.NAME AND ABS(L.TS-?)<2000 ORDER BY ABS(L.TS-?) LIMIT 1",
                "SELECT DIMENSION,SUM(POINTS) N FROM GROWTH_EVENTS GROUP BY DIMENSION",
                "SELECT DOC_JSON FROM SYNC_ROWS WHERE TABLE_NAME='BALANCES'",
                "SELECT COALESCE(SUM(COALESCE(SECONDS, MINUTES * 60)), 0) AS TOTAL FROM FOCUS_SESSIONS WHERE ENDED_AT >= ? AND ENDED_AT < ?",
                "SELECT L.*, H.NAME FROM HABIT_LOGS L LEFT JOIN HABITS H ON L.HABIT_ID=H.ID WHERE L.DATE LIKE ? ORDER BY L.TS",
                "SELECT * FROM JOURNALS WHERE TS >= ? AND TS < ?",
                "SELECT * FROM FOCUS_SESSIONS WHERE ENDED_AT >= ? AND ENDED_AT < ?",
                "SELECT TOKEN,BODY FROM FOCUS_RECOVERY WHERE ID=1",
                "SELECT JSON FROM SETTINGS WHERE ID=1",
                "SELECT 1 FROM SETTINGS WHERE ID=1",
                "SELECT 1 FROM SETTINGS WHERE ID = 1",
                "SELECT * FROM SETTINGS",
                "SELECT * FROM SETTINGS WHERE ID=1",
                "SELECT * FROM SETTINGS ORDER BY ID",
                "SELECT * FROM HABITS WHERE DELETED_AT IS NULL ORDER BY SORT_ORDER ASC, ID ASC",
                "SELECT VALUE FROM DEVICE_RESOURCES WHERE KEY=?",
                "SELECT ID,PATH,TITLE FROM MUSIC_IMPORTS ORDER BY CREATEDAT,ID",
                "SELECT RESULT_JSON FROM FOCUS_COMMITS WHERE TOKEN=?",
                "SELECT RESULT_JSON FROM JOURNAL_COMMITS WHERE TOKEN=?",
                "SELECT ID FROM REVIEW_CARDS WHERE ID=?",
                "SELECT CARDID,RATING FROM REVIEW_LOGS WHERE TOKEN=?",
                "SELECT NAME,DIMENSION FROM HABITS WHERE ID=? AND DELETED_AT IS NULL",
                "SELECT * FROM SYNC_CONFLICTS ORDER BY ID",
                "SELECT DETAIL FROM SYNC_CONFLICTS WHERE ID=?",
                "SELECT ID FROM SYNC_BACKUPS LIMIT 1",
                "SELECT BODY FROM SYNC_BACKUPS ORDER BY ID DESC LIMIT 1",
                "SELECT COUNT(*) AS N FROM TODOS WHERE DONE=1 OR FOCUS_MINUTES>0",
                "SELECT 1 FROM FOCUS_COMMITS WHERE TOKEN=? LIMIT 1",
                "INSERT OR IGNORE INTO MUSIC_IMPORTS VALUES (?,?,?,?)",
                "INSERT INTO REVIEW_LOGS VALUES (?,?,?,?,?,?,?)");
    }

    private SqlBridgePolicy() { }

    public static void validate(String operation, String sql) {
        if (!("exec".equals(operation) || "run".equals(operation) || "query".equals(operation))) {
            reject();
        }
        if (sql == null || sql.length() == 0 || sql.length() > MAX_SQL_LENGTH) reject();
        List<String> statements = "exec".equals(operation) ? splitStatements(sql) : Collections.singletonList(sql);
        if (statements.isEmpty()) reject();
        for (String statement : statements) validateOne(operation, statement);
    }

    private static void validateOne(String operation, String source) {
        String sql = normalize(source);
        if (sql.length() == 0 || sql.indexOf(';') >= 0) reject();
        if ("query".equals(operation) && validatePragma(sql)) return;
        if (containsForbidden(sql)) reject();
        if ("exec".equals(operation)) {
            if (isDdl(sql) || "DELETE FROM FOCUS_SESSIONS".equals(sql)
                    || "DELETE FROM JOURNALS".equals(sql) || "DELETE FROM HABIT_LOGS".equals(sql)
                    || "DELETE FROM REVIEW_LOGS".equals(sql) || "DELETE FROM GROWTH_EVENTS".equals(sql)
                    || "UPDATE TODOS SET DONE=0,COMPLETED_AT=NULL,FOCUS_MINUTES=0".equals(sql)
                    || "UPDATE GROWTH_META SET EPOCH=EPOCH+1 WHERE ID=1".equals(sql)
                    || "UPDATE HABITS SET SORT_ORDER=ID".equals(sql)
                    || "CREATE TABLE IF NOT EXISTS DEVICE_RESOURCES(KEY TEXT PRIMARY KEY,VALUE TEXT NOT NULL)".equals(sql)
                    || "CREATE TABLE IF NOT EXISTS DEVICE_RESOURCES (KEY TEXT PRIMARY KEY,VALUE TEXT NOT NULL)".equals(sql)
                    || (sql.startsWith("DELETE FROM ") && EXEC_CLEAR_TABLES.contains(sql.substring("DELETE FROM ".length())))
                    || sql.matches("INSERT OR IGNORE INTO GROWTH_META\\s*\\(ID,\\s*EPOCH\\) VALUES \\(1,0\\)")) return;
            reject();
        } else if ("run".equals(operation)) {
            if (validateInsert(sql) || validateUpdate(sql) || validateDelete(sql)) return;
            reject();
        } else {
            if (validateQuery(sql)) return;
            reject();
        }
    }

    private static boolean validateInsert(String sql) {
        // The only INSERT containing a subquery is the fixed habit ordering expression.
        if ("INSERT INTO HABITS (NAME, DIMENSION, WEEKLY_TARGET, SORT_ORDER) VALUES (?, ?, ?, (SELECT COALESCE(MAX(SORT_ORDER),0)+1 FROM HABITS))".equals(sql)
                || "INSERT INTO HABITS (NAME, DIMENSION, WEEKLY_TARGET) VALUES (?, ?, 7)".equals(sql)
                || "INSERT OR IGNORE INTO MUSIC_IMPORTS VALUES (?,?,?,?)".equals(sql)
                || "INSERT INTO REVIEW_LOGS VALUES (?,?,?,?,?,?,?)".equals(sql)) return true;
        Matcher m = INSERT.matcher(sql);
        if (!m.matches()) return false;
        String table = m.group(1);
        String columns = csvKey(m.group(2));
        List<String> values = splitCsv(m.group(3));
        if (values.size() != columns.split(",").length) return false;
        if (validateSyncInsert(sql, table, columns, values)) return true;
        if (!TABLES.contains(table) || !INSERT_COLUMNS.getOrDefault(table, Collections.emptySet()).contains(columns)) return false;
        for (String value : values) if (!value.matches("\\?|NULL|[0-9]+")) return false;
        if ("SETTINGS".equals(table)) {
            if (!sql.startsWith("INSERT INTO SETTINGS ") || !"ID,JSON".equals(columns)) return false;
            if (!("1,?".equals(String.join(",", values)) || "?,?".equals(String.join(",", values)))) return false;
        }
        return true;
    }

    private static boolean validateSyncInsert(String sql, String table, String columns, List<String> values) {
        // materialize() binds a complete business row in document field order.
        // Fresh numeric rows let SQLite allocate the local ID; resurrected rows
        // may provide it. String keys remain mandatory. This is deliberately
        // separate from the fixed migration/backup catalog and SETTINGS rules.
        if (!sql.startsWith("INSERT INTO ") || !SYNC_BUSINESS_TABLES.contains(table)) return false;
        for (String value : values) if (!"?".equals(value)) return false;
        List<String> listed = Arrays.asList(columns.split(","));
        Set<String> supplied = new HashSet<>(listed);
        if (supplied.size() != listed.size()) return false;
        Set<String> required = new HashSet<>(COLUMNS.get(table));
        if (!"REVIEW_CARDS".equals(table) && !"REVIEW_LOGS".equals(table)) {
            required.remove("ID");
            supplied.remove("ID");
        }
        // This local deduplication marker is absent from sync documents.
        if ("GROWTH_EVENTS".equals(table)) {
            required.remove("SYNC_CAUSE");
            supplied.remove("SYNC_CAUSE");
        }
        return required.equals(supplied);
    }

    private static boolean validateUpdate(String sql) {
        if ("UPDATE TODOS SET COMPLETED_AT = CASE WHEN DONE = 0 THEN ? ELSE NULL END, DONE = 1 - DONE WHERE ID = ?".equals(sql)) return true;
        if ("UPDATE REVIEW_CARDS SET DUEDATE=?,INTERVALDAYS=0,REVIEWS=0,VERSION=VERSION+1,UPDATEDAT=?".equals(sql)) return true;
        if ("UPDATE HABITS SET DELETED_AT=NULL,SORT_ORDER=(SELECT COALESCE(MAX(SORT_ORDER),0)+1 FROM HABITS) WHERE ID=? AND DELETED_AT IS NOT NULL".equals(sql)) return true;
        Matcher m = UPDATE.matcher(sql);
        if (!m.matches() || !TABLES.contains(m.group(1))) return false;
        String table = m.group(1);
        if ("SETTINGS".equals(table)) return "UPDATE SETTINGS SET JSON=? WHERE ID=1".equals(canonical(sql));
        for (String assignment : splitCsv(m.group(2))) {
            String[] pair = assignment.split("=", 2);
            if (pair.length != 2) return false;
            String column = unquote(pair[0].trim());
            if (!IDENT.matcher(column).matches()) return false;
            if (!COLUMNS.get(table).contains(column) || !allowedUpdateColumn(table, column)) return false;
            String expression = pair[1].trim();
            String compactExpression = expression.replace(" ", "");
            if (!(expression.equals("?") || expression.equals("NULL") || expression.equals("0") || expression.equals("1")
                    || compactExpression.equals(column + "+?") || compactExpression.equals(column + "+1")
                    || compactExpression.equals("1-" + column))) return false;
        }
        if (m.group(3) == null) return false;
        if ("SETTINGS".equals(table) && !"ID=1".equals(canonical(m.group(3).trim()))) return false;
        return safeWhere(table, m.group(3));
    }

    private static boolean validateDelete(String sql) {
        Matcher m = DELETE.matcher(sql);
        if (!m.matches() || !TABLES.contains(m.group(1))) return false;
        if ("SETTINGS".equals(m.group(1))) return m.group(2)==null || "ID=1".equals(canonical(m.group(2).trim()));
        if (m.group(2) == null) return BACKUP_TABLES.contains(m.group(1)) || RUN_CLEAR_TABLES.contains(m.group(1));
        return safeWhere(m.group(1), m.group(2));
    }

    private static boolean validateQuery(String sql) {
        if (EXACT_QUERIES.contains(sql)) return true;
        if (sql.contains(" FROM SETTINGS") && !canonical(sql).equals("SELECT JSON FROM SETTINGS WHERE ID=1")
                && !sql.equals("SELECT * FROM SETTINGS") && !canonical(sql).equals("SELECT * FROM SETTINGS WHERE ID=1")
                && !sql.equals("SELECT * FROM SETTINGS ORDER BY ID")) return false;
        Matcher count = COUNT.matcher(sql);
        if (count.matches() && TABLES.contains(count.group(1))) return safeQueryTail(count.group(2), count.group(1));
        Matcher star = SELECT_STAR.matcher(sql);
        if (star.matches() && TABLES.contains(star.group(1))) return safeQueryTail(star.group(2), star.group(1));
        Matcher columns = SELECT_COLUMNS.matcher(sql);
        if (!columns.matches() || !TABLES.contains(columns.group(2))) return false;
        String projection = columns.group(1).trim();
        if (!projection.equals("1") && !allColumns(columns.group(2), projection)) return false;
        return safeQueryTail(columns.group(3), columns.group(2));
    }

    private static boolean validatePragma(String sql) {
        Matcher match = Pattern.compile("^PRAGMA TABLE_INFO\\(([A-Z_][A-Z0-9_]*)\\)$").matcher(sql);
        return match.matches() && TABLES.contains(match.group(1));
    }

    private static boolean safeQueryTail(String tail, String table) {
        if (tail == null || tail.isEmpty()) return true;
        if (tail.matches(" WHERE [A-Z_][A-Z0-9_]*\\s*=\\s*(?:\\?|1)")) return safeWhere(table, tail.substring(7));
        if (tail.matches(" WHERE [A-Z_][A-Z0-9_]* IS NULL")) return COLUMNS.get(table).contains(tail.substring(7, tail.length() - 9).trim());
        if (tail.matches(" WHERE [A-Z_][A-Z0-9_]* IS NOT NULL")) return COLUMNS.get(table).contains(tail.substring(7, tail.length() - 13).trim());
        if (tail.matches(" WHERE [A-Z_][A-Z0-9_]* IS NULL ORDER BY [A-Z_][A-Z0-9_]*(?: ASC| DESC)?(?:,\\s*[A-Z_][A-Z0-9_]*(?: ASC| DESC)?)*")) {
            int order = tail.indexOf(" ORDER BY ");
            String column = tail.substring(7, order).trim();
            return COLUMNS.get(table).contains(column) && orderColumnsExist(table, tail.substring(order + 10));
        }
        if (tail.matches(" WHERE [A-Z_][A-Z0-9_]*\\s*=\\s*\\? AND [A-Z_][A-Z0-9_]*\\s*=\\s*\\?")) return safeWhere(table, tail.substring(7));
        if (tail.matches(" WHERE [A-Z_][A-Z0-9_]*\\s*=\\s*\\? AND [A-Z_][A-Z0-9_]* IS NULL")) return safeWhere(table, tail.substring(7));
        if (tail.matches(" WHERE [A-Z_][A-Z0-9_]* BETWEEN 1 AND 7 ORDER BY [A-Z_][A-Z0-9_]*(?: ASC| DESC)?(?:,\\s*[A-Z_][A-Z0-9_]*(?: ASC| DESC)?)*")) return true;
        if (tail.matches(" ORDER BY [A-Z_][A-Z0-9_]*(?: ASC| DESC)?(?:,\\s*[A-Z_][A-Z0-9_]*(?: ASC| DESC)?)*(?: LIMIT (?:\\?|1))?")) return orderColumnsExist(table, tail.substring(10));
        if (tail.matches(" WHERE [A-Z_][A-Z0-9_]* LIKE \\? ORDER BY [A-Z_][A-Z0-9_]*(?: ASC| DESC)?")) return true;
        if (tail.matches(" LIMIT 1")) return true;
        return false;
    }

    private static boolean safeWhere(String table, String where) {
        String w = canonical(where.trim());
        if (w.matches("[A-Z_][A-Z0-9_]*=(?:\\?|1)")) return COLUMNS.get(table).contains(w.substring(0, w.indexOf('=')));
        if (w.matches("[A-Z_][A-Z0-9_]* IS NULL") || w.matches("[A-Z_][A-Z0-9_]* IS NOT NULL")) return COLUMNS.get(table).contains(w.split(" ")[0]);
        if (w.matches("[A-Z_][A-Z0-9_]*=\\? AND [A-Z_][A-Z0-9_]*=\\?")) {
            String[] parts = w.split(" AND ");
            return safeWhere(table, parts[0]) && safeWhere(table, parts[1]);
        }
        if (w.matches("[A-Z_][A-Z0-9_]*=\\? AND [A-Z_][A-Z0-9_]* IS NULL")) {
            String[] parts = w.split(" AND ");
            return safeWhere(table, parts[0]) && safeWhere(table, parts[1]);
        }
        if (w.matches("[A-Z_][A-Z0-9_]*=1 AND [A-Z_][A-Z0-9_]*=\\?")) {
            String[] parts = w.split(" AND ");
            return safeWhere(table, parts[0]) && safeWhere(table, parts[1]);
        }
        return false;
    }

    private static boolean allColumns(String table, String projection) {
        for (String column : splitCsv(projection)) if (!COLUMNS.get(table).contains(unquote(column))) return false;
        return true;
    }

    private static boolean orderColumnsExist(String table, String order) {
        String value = order.replaceFirst(" LIMIT (?:\\?|1)$", "");
        for (String item : value.split(",")) {
            String column = item.trim().replaceFirst(" (?:ASC|DESC)$", "");
            if (!COLUMNS.get(table).contains(unquote(column))) return false;
        }
        return true;
    }

    private static boolean allowedUpdateColumn(String table, String column) {
        if (SYNC_BUSINESS_TABLES.contains(table)) return !"ID".equals(column) && COLUMNS.get(table).contains(column);
        if ("SETTINGS".equals(table)) return "JSON".equals(column);
        if ("STATS".equals(table)) return "POINTS_JSON".equals(column);
        if ("GROWTH_META".equals(table)) return "EPOCH".equals(column);
        if ("GROWTH_RESETS".equals(table)) return "UNDONE".equals(column);
        if ("PENDING_CLIENT_RESTORE".equals(table)) return "TOKEN".equals(column);
        if ("FOCUS_SESSIONS".equals(table)) return "SECONDS".equals(column) || "SYNC_TOKEN".equals(column);
        if ("GROWTH_EVENTS".equals(table)) return "SYNC_CAUSE".equals(column);
        if ("TODOS".equals(table)) return "DONE".equals(column) || "COMPLETED_AT".equals(column) || "FOCUS_MINUTES".equals(column);
        if ("HABITS".equals(table)) return "SORT_ORDER".equals(column) || "DELETED_AT".equals(column);
        if ("REVIEW_CARDS".equals(table)) return set("QUESTION", "ANSWER", "TOPIC", "SOURCEROOT", "SOURCEPATH", "DUEDATE", "INTERVALDAYS", "REVIEWS", "ARCHIVED", "VERSION", "UPDATEDAT").contains(column);
        return "SYNC_META".equals(table) || "SYNC_ROWS".equals(table) || "SYNC_CONFLICTS".equals(table);
    }

    private static boolean isDdl(String sql) {
        String compact = sql.replaceAll(", ", ",");
        for (String expression : DDL_PATTERNS) {
            if (sql.matches(expression) || compact.matches(expression.replace(", ", ","))) return true;
        }
        return false;
    }

    private static boolean containsForbidden(String sql) {
        return sql.matches(".*\\b(?:ATTACH|DETACH|PRAGMA|LOAD_EXTENSION|VACUUM|REINDEX|ANALYZE|TRIGGER|VIEW|VIRTUAL|EXPLAIN|WITH|RECURSIVE)\\b.*")
                || sql.contains("SQLITE_MASTER") || sql.contains("SQLITE_SCHEMA") || sql.contains("WRITABLE_SCHEMA")
                || sql.contains("JSON_EXTRACT") || sql.contains("SUBSTR(") || sql.contains("--") || sql.contains("/*") || sql.contains("*/");
    }

    private static List<String> splitStatements(String sql) {
        List<String> result = new ArrayList<>();
        StringBuilder current = new StringBuilder();
        char quote = 0;
        for (int i = 0; i < sql.length(); i++) {
            char c = sql.charAt(i);
            if (c < 0x20 && c != '\n' && c != '\r' && c != '\t') reject();
            if (quote != 0) {
                current.append(c);
                if (c == quote) {
                    if (i + 1 < sql.length() && sql.charAt(i + 1) == quote) current.append(sql.charAt(++i));
                    else quote = 0;
                }
            } else if (c == '\'' || c == '"') {
                quote = c; current.append(c);
            } else if (c == ';') {
                if (current.toString().trim().isEmpty()) reject();
                result.add(current.toString()); current.setLength(0);
            } else current.append(c);
        }
        if (quote != 0) reject();
        if (!current.toString().trim().isEmpty()) result.add(current.toString());
        return result;
    }

    private static String normalize(String sql) {
        if (sql == null) reject();
        String value = sql.trim().replaceAll("\\s+", " ").toUpperCase(Locale.ROOT);
        value = value.replaceAll("\\( ", "(").replaceAll(" \\)", ")");
        if (value.length() == 0 || value.length() > MAX_SQL_LENGTH) reject();
        return value;
    }

    private static String canonical(String sql) {
        return sql.replaceAll("\\s*=\\s*", "=");
    }

    private static List<String> splitCsv(String value) {
        List<String> result = new ArrayList<>();
        int depth = 0; StringBuilder current = new StringBuilder(); char quote = 0;
        for (int i = 0; i < value.length(); i++) {
            char c = value.charAt(i);
            if (quote != 0) { current.append(c); if (c == quote) quote = 0; continue; }
            if (c == '\'' || c == '"') { quote = c; current.append(c); }
            else if (c == '(') { depth++; current.append(c); }
            else if (c == ')') { depth--; current.append(c); }
            else if (c == ',' && depth == 0) { result.add(current.toString().trim()); current.setLength(0); }
            else current.append(c);
        }
        result.add(current.toString().trim());
        return result;
    }

    private static String csvKey(String value) {
        List<String> values = splitCsv(value); StringBuilder out = new StringBuilder();
        for (String item : values) { String name = unquote(item); if (!IDENT.matcher(name).matches()) reject(); if (out.length() > 0) out.append(','); out.append(name); }
        return out.toString();
    }

    private static String unquote(String value) {
        String trimmed = value.trim();
        if (trimmed.startsWith("\"") && trimmed.endsWith("\"")) trimmed = trimmed.substring(1, trimmed.length() - 1);
        return trimmed;
    }

    private static Set<String> set(String... values) { return new HashSet<>(Arrays.asList(values)); }
    private static void insert(Map<String, Set<String>> map, String table, String columns) { map.computeIfAbsent(table, ignored -> new HashSet<>()).add(columns); }
    private static void reject() { throw new IllegalArgumentException("数据库操作不在允许范围内"); }
}
