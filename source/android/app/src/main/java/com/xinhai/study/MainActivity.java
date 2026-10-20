package com.xinhai.study;

import android.app.Activity;
import android.content.*;
import android.content.res.AssetFileDescriptor;
import android.database.Cursor;
import android.database.sqlite.*;
import android.graphics.Color;
import android.net.Uri;
import android.os.*;
import android.provider.DocumentsContract;
import android.provider.OpenableColumns;
import android.util.Log;
import android.view.*;
import android.webkit.*;
import android.widget.FrameLayout;
import android.widget.Toast;
import org.json.*;
import java.io.*;
import java.net.*;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.*;
import java.util.concurrent.*;
import java.util.regex.Pattern;

public class MainActivity extends Activity {
    static final String HOST="app.xinhai.local";
    private static final String ORIGIN="https://"+HOST;
    private static final String RESOURCE_MIGRATION="android-resource-migration-v1";
    private static final String RESOURCE_MIGRATION_ERROR="android-resource-migration-v1-error";
    private static final String RESOURCE_KNOWLEDGE_TREE="knowledgeTree";
    private static final String RESOURCE_KNOWLEDGE_LOCAL_ROOT="knowledgeLocalRoot";
    private static final Set<String> MUSIC_EXTENSIONS=new HashSet<>(Arrays.asList("mp3","ogg","wav","flac","m4a","aac","opus"));
    private WebView web;
    private NetEaseService netease;
    private SQLiteDatabase database;
    private SharedPreferences preferences;
    private ThemeFiles themeFiles;
    private BackupFiles backupFiles;
    private ModelService modelService;
    private PrivacyErase privacyErase;
    private ClientStateStore clientStateStore;
    private final ExecutorService worker=Executors.newSingleThreadExecutor();
    private final Object workGate=new Object();
    private int activeWorkers=0;
    private volatile boolean erasureScheduled=false;
    private String pendingId, pendingMethod;
    private JSONObject pendingArgs;
    private final Map<String,Uri> noteUris=new HashMap<>();
    private final Map<String,String> noteParents=new HashMap<>();
    private int skippedNotes=0;
    private volatile MusicRemoveReceipt musicRemoveReceipt;

    private static final class MusicRemoveReceipt {
        final String id,path,title,legacyEntry,afterSignature;
        final long createdAt;
        final int legacyIndex;
        final boolean legacy;
        MusicRemoveReceipt(String id,String path,String title,long createdAt,String legacyEntry,int legacyIndex,boolean legacy,String afterSignature){
            this.id=id;this.path=path;this.title=title;this.createdAt=createdAt;this.legacyEntry=legacyEntry;this.legacyIndex=legacyIndex;this.legacy=legacy;this.afterSignature=afterSignature;
        }
    }

    @Override public void onCreate(Bundle state){
        super.onCreate(state);
        // Repeated launcher intents must return to the existing WebView.
        if(!isTaskRoot() && Intent.ACTION_MAIN.equals(getIntent().getAction()) && getIntent().hasCategory(Intent.CATEGORY_LAUNCHER)){finish();return;}
        netease=new NetEaseService(this);
        preferences=getSharedPreferences("xinhai",MODE_PRIVATE);
        themeFiles=new ThemeFiles(this);
        backupFiles=new BackupFiles(this);
        privacyErase=new PrivacyErase(this);
        database=SQLiteDatabase.openOrCreateDatabase(new File(getFilesDir(),"xinhai.db"),null);
        database.enableWriteAheadLogging();
        modelService=new ModelService(this,database);
        initializeResourceStore();
        if(BuildConfig.COMMERCIAL_EDITION)clientStateStore=new ClientStateStore(database);
        else{
            // Keep the personal learning database unchanged; migrate only the
            // existing allowlisted WebView draft/preference keys into a sidecar.
            SQLiteDatabase personalState=SQLiteDatabase.openOrCreateDatabase(new File(getFilesDir(),"personal-client-state.db"),null);
            personalState.enableWriteAheadLogging();
            clientStateStore=new ClientStateStore(personalState);
        }
        FrameLayout frame=new FrameLayout(this);frame.setBackgroundColor(Color.rgb(16,16,16));
        web=new WebView(this);web.setBackgroundColor(Color.rgb(16,16,16));
        frame.addView(web,new FrameLayout.LayoutParams(-1,-1));setContentView(frame);
        if(Build.VERSION.SDK_INT>=30){
            getWindow().setDecorFitsSystemWindows(false);
            frame.setOnApplyWindowInsetsListener((v,insets)->{android.graphics.Insets bars=insets.getInsets(WindowInsets.Type.displayCutout()|WindowInsets.Type.ime());v.setPadding(bars.left,bars.top,bars.right,bars.bottom);return insets;});
        }
        getWindow().setStatusBarColor(Color.TRANSPARENT);getWindow().setNavigationBarColor(Color.TRANSPARENT);
        if(Build.VERSION.SDK_INT>=29){getWindow().setStatusBarContrastEnforced(false);getWindow().setNavigationBarContrastEnforced(false);}
        immersive();
        WebSettings settings=web.getSettings();settings.setJavaScriptEnabled(true);settings.setDomStorageEnabled(true);
        settings.setAllowFileAccess(false);settings.setAllowContentAccess(false);settings.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        settings.setMediaPlaybackRequiresUserGesture(false);settings.setTextZoom(100);settings.setSupportMultipleWindows(false);
        WebView.setWebContentsDebuggingEnabled(BuildConfig.DEBUG);
        web.addJavascriptInterface(new Bridge(),"XinhaiNative");
        web.setWebChromeClient(new WebChromeClient());
        web.setWebViewClient(new WebViewClient(){
            @Override public boolean shouldOverrideUrlLoading(WebView view,WebResourceRequest request){
                // Never navigate the privileged bridge to user content or a remote page.
                Uri uri=request.getUrl();if(HOST.equals(uri.getHost())&&"/mobile.html".equals(uri.getPath())&&"https".equals(uri.getScheme()))return false;
                openExternal(uri);return true;
            }
            @Override public WebResourceResponse shouldInterceptRequest(WebView view,WebResourceRequest request){return resource(request);}
            @Override public void onPageFinished(WebView view,String url){view.evaluateJavascript("window.dispatchEvent(new Event('xinhai-resume'))",null);}
        });
        web.loadUrl(ORIGIN+"/mobile.html");
    }

    private void immersive(){
        if(Build.VERSION.SDK_INT>=30){
            WindowInsetsController controller=getWindow().getInsetsController();
            if(controller!=null){controller.setSystemBarsBehavior(WindowInsetsController.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE);controller.hide(WindowInsets.Type.systemBars());}
        }else getWindow().getDecorView().setSystemUiVisibility(View.SYSTEM_UI_FLAG_LAYOUT_STABLE|View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN|View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION|View.SYSTEM_UI_FLAG_FULLSCREEN|View.SYSTEM_UI_FLAG_HIDE_NAVIGATION|View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY);
    }
    @Override public void onWindowFocusChanged(boolean focused){super.onWindowFocusChanged(focused);if(focused)immersive();}
    @Override protected void onNewIntent(Intent intent){super.onNewIntent(intent);setIntent(intent);immersive();}
    @Override protected void onPause(){if(web!=null){web.evaluateJavascript("window.dispatchEvent(new Event('xinhai-pause'))",null);web.onPause();}super.onPause();}
    @Override protected void onResume(){super.onResume();FocusReminder.resume(this);if(web!=null){web.onResume();web.evaluateJavascript("window.dispatchEvent(new Event('xinhai-resume'))",null);}}
    @Override public void onBackPressed(){web.evaluateJavascript("(()=>{const d=document.querySelector('dialog.focus-reminder[open]')||document.querySelector('dialog.march-memory[open]')||document.querySelector('dialog.startup-announcement[open]');if(d){if(d.dispatchEvent(new Event('cancel',{cancelable:true})))d.close();return}const b=document.querySelector('.restore-ui');if(b){b.click();return}const active=document.activeElement;if(active&&/INPUT|TEXTAREA/.test(active.tagName)){active.blur();return}const home=document.querySelector('.command-item');if(home&&!home.classList.contains('is-active')){home.click();return}window.XinhaiNative.call('minimize','{}')})()",null);}
    @Override protected void onDestroy(){if(web!=null){web.removeJavascriptInterface("XinhaiNative");web.destroy();}worker.shutdown();super.onDestroy();}

    private static JSONObject ok(Object value)throws JSONException{return new JSONObject().put("ok",true).put("value",value==null?JSONObject.NULL:value);}
    private static JSONObject failure(Exception e){try{return new JSONObject().put("ok",false).put("error",e.getMessage()==null?"操作未完成，请重试。":e.getMessage());}catch(Exception ignored){return new JSONObject();}}
    private void reply(String id,JSONObject result){String raw=result.toString();runOnUiThread(()->{if(!isFinishing())web.evaluateJavascript("window.__xinhaiResult&&window.__xinhaiResult("+JSONObject.quote(id)+","+JSONObject.quote(raw)+")",null);});}
    private void openExternal(Uri uri){
        String scheme=uri.getScheme();if(!Arrays.asList("https","http","obsidian").contains(scheme))return;
        runOnUiThread(()->{try{startActivity(new Intent(Intent.ACTION_VIEW,uri));}catch(Exception e){Toast.makeText(this,"未找到可以打开此链接的应用",Toast.LENGTH_SHORT).show();}});
    }

    public class Bridge {
        @JavascriptInterface public synchronized String call(String method,String args){synchronized(workGate){try{if(erasureScheduled)throw new IOException("系统正在清理本应用资料");return ok(dispatch(method,new JSONObject(args))).toString();}catch(Exception e){return failure(method!=null&&method.startsWith("model")?new IOException(ModelService.safeMessage(e)):e).toString();}}}
        @JavascriptInterface public void request(String id,String method,String args){
            try{
                JSONObject input=new JSONObject(args);
                if(erasureScheduled)throw new IOException("系统正在清理本应用资料");
                if(BuildConfig.COMMERCIAL_EDITION&&method.startsWith("netease"))throw new IOException("本版本提供本地音乐，未提供在线音乐接入。");
                if("clearOnlineMusicData".equals(method)){
                    synchronized(workGate){if(erasureScheduled)throw new IOException("系统正在清理本应用资料");activeWorkers++;}
                    runOnUiThread(()->netease.clearLegacyData(error->{
                        try{reply(id,error==null?ok(null):failure(error));}
                        catch(Exception e){reply(id,failure(e));}
                        finally{synchronized(workGate){activeWorkers--;}}
                    }));return;
                }
                if("privacyErase".equals(method)){
                    runOnUiThread(()->{try{
                        synchronized(workGate){
                            if(erasureScheduled)throw new IOException("系统正在清理本应用资料");
                            if(pendingId!=null||activeWorkers!=0||database.inTransaction())throw new IOException("请先完成当前文件或网络操作，再清理资料");
                            erasureScheduled=true;
                            try{privacyErase.erase(input,activeKnowledgeTree());}catch(Exception e){erasureScheduled=false;throw e;}
                            worker.shutdown();
                        }
                        web.stopLoading();web.onPause();reply(id,ok(new JSONObject().put("accepted",true)));
                    }catch(Exception e){reply(id,failure(e));}});return;
                }
                if("backupVerify".equals(method)){submitWork(()->{try{reply(id,ok(backupFiles.verifyImport(input.getString("ticket"))));}catch(Exception e){reply(id,failure(e));}});return;}
                if("modelRequest".equals(method)){submitWork(()->{try{reply(id,ok(modelService.request(input)));}catch(Exception e){reply(id,failure(new IOException(ModelService.safeMessage(e))));}});return;}
                if("neteaseShareRedirect".equals(method)){submitWork(()->{try{reply(id,ok(netease.shareRedirect(input.getString("url"))));}catch(Exception e){reply(id,failure(e));}});return;}
                if("neteaseRequest".equals(method)){submitWork(()->{try{reply(id,ok(netease.request(input.getString("path"))));}catch(Exception e){reply(id,failure(e));}});return;}
                if(method.startsWith("netease")){runOnUiThread(()->{try{if(erasureScheduled)throw new IOException("系统正在清理本应用资料");switch(method){case "neteaseLogin":netease.login();break;case "neteaseLogout":netease.logout();break;case "neteaseOpen":netease.open(input.getString("id"));break;default:throw new IOException("不支持的网易云操作");}reply(id,ok(null));}catch(Exception e){reply(id,failure(e));}});return;}

                if("http".equals(method)){
                    if(BuildConfig.COMMERCIAL_EDITION){reply(id,failure(new IOException("本版本不提供通用网络请求入口")));return;}
                    submitWork(()->{try{reply(id,ok(http(input)));}catch(Exception e){reply(id,failure(e));}});return;
                }
                if("syncHttp".equals(method)){submitWork(()->{try{reply(id,ok(LanSyncHttp.request(input)));}catch(Exception e){reply(id,failure(e));}});return;}
                runOnUiThread(()->choose(id,method,input));
            }catch(Exception e){reply(id,failure(e));}
        }
    }

    private ClientStateStore clientState() throws IOException {
        if(clientStateStore==null)throw new IOException("本机客户端状态存储尚未准备好");
        return clientStateStore;
    }
    private static String clientString(JSONObject args,String key)throws JSONException {
        Object value=args.get(key);
        if(!(value instanceof String))throw new JSONException("客户端存储参数必须是字符串");
        return (String)value;
    }
    private Object dispatch(String method,JSONObject args)throws Exception{
        switch(method){
            case "clientStateInit":return clientState().initialize(args.getJSONObject("state"));
            case "clientStateSet":clientState().set(clientString(args,"key"),clientString(args,"value"));return null;
            case "clientStateRemove":clientState().remove(clientString(args,"key"));return null;
            case "clientStateClear":clientState().clear();return null;
            case "privacyPrepare":return privacyErase.prepare(activeKnowledgeTree());
            case "privacyCancel":privacyErase.cancel();return null;
            case "sqlExec":
                if(BuildConfig.COMMERCIAL_EDITION)SqlBridgePolicy.validate("exec",args.getString("sql"));
                for(String sql:args.getString("sql").split(";"))if(!sql.trim().isEmpty()){database.execSQL(sql);invalidateMusicUndoForSql(sql);}return null;
            case "sqlBegin":database.beginTransaction();return null;
            case "sqlEnd":if(args.getBoolean("success"))database.setTransactionSuccessful();database.endTransaction();return null;
            case "sqlRun":return sqlRun(args);
            case "sqlQuery":return sqlQuery(args);
            case "musicList":return musicList();
            case "musicRemove":return removeMusic(args.getString("id"));
            case "musicUndoRemove":return undoRemoveMusic(args.getString("id"));
            case "knowledgeList":return knowledgeList();
            case "knowledgeSave":return knowledgeSave(args);
            case "knowledgeCreate":return knowledgeCreate(args.getString("title"),args.has("initialContent")&&!args.isNull("initialContent")?args.getString("initialContent"):null,args.has("expectedRoot")&&!args.isNull("expectedRoot")?args.getString("expectedRoot"):null);
            case "knowledgeRename":return knowledgeRename(args);
            case "knowledgeDelete":knowledgeDelete(args);return null;
            case "knowledgeSetCategory":return knowledgeSetCategory(args);
            case "knowledgeFolder":return "平板笔记保存在本机。使用“选择已有库”连接共享文件夹，或在系统文件管理器中打开你授权的文件夹。";
            case "backupContext":
                if(!resourceMigrationReady())throw new IOException("资源迁移未完成，暂不能创建备份。");
                return new JSONObject().put("knowledgeRoot",activeKnowledgeTree().isEmpty()?"本机学习库":activeKnowledgeTree());
            case "backupFinish":
                return backupFiles.finishArchive(args.getString("ticket"),args.optBoolean("keep",false));
            case "modelStatus":return modelService.status();
            case "modelSave":return modelService.save(args);
            case "modelClear":return modelService.clear();
            case "knowledgeObsidian":
                String tree=activeKnowledgeTree();
                if(tree.isEmpty())throw new IOException("请先选择与 Obsidian 共用的本机文件夹，再在 Obsidian 中打开该文件夹。");
                openExternal(Uri.parse("obsidian://open"));return null;
            case "elapsedRealtime":return SystemClock.elapsedRealtime();
            case "keepAwake":runOnUiThread(()->web.setKeepScreenOn(args.optBoolean("enabled")));return null;
            case "focusReminder":FocusReminder.update(this,args);return null;
            case "focusReminderStatus":return FocusReminder.status(this);
            case "focusReminderRequestAccess":FocusReminder.requestAccess(this,args.getString("access"));return null;
            case "minimize":runOnUiThread(()->moveTaskToBack(true));return null;
            case "close":runOnUiThread(()->finish());return null;
            case "themeImportFinish":return themeFiles.finishImport(args);
            default:throw new IllegalArgumentException("不支持的操作");
        }
    }
    private SQLiteStatement statement(JSONObject args)throws Exception{
        SQLiteStatement st=database.compileStatement(args.getString("sql"));JSONArray values=args.getJSONArray("values");
        for(int i=0;i<values.length();i++){Object v=values.get(i);int index=i+1;if(v==JSONObject.NULL)st.bindNull(index);else if(v instanceof Float||v instanceof Double)st.bindDouble(index,((Number)v).doubleValue());else if(v instanceof Number)st.bindLong(index,((Number)v).longValue());else if(v instanceof Boolean)st.bindLong(index,(Boolean)v?1:0);else st.bindString(index,v.toString());}
        return st;
    }
    private JSONObject sqlRun(JSONObject args)throws Exception{
        if(BuildConfig.COMMERCIAL_EDITION)SqlBridgePolicy.validate("run",args.getString("sql"));
        JSONObject safeArgs=protectSettingsMutation(args);
        try(SQLiteStatement st=statement(safeArgs)){
            if(args.getString("sql").trim().toUpperCase(Locale.ROOT).startsWith("INSERT")){long id=st.executeInsert();invalidateMusicUndoForSql(args.getString("sql"));return new JSONObject().put("changes",id<0?0:1).put("lastInsertRowid",Math.max(0,id));}
            int changed=st.executeUpdateDelete();invalidateMusicUndoForSql(args.getString("sql"));return new JSONObject().put("changes",changed).put("lastInsertRowid",0);
        }
    }

    private void invalidateMusicUndoForSql(String sql){
        if(musicRemoveReceipt==null)return;
        // Restore/sync SQL may replace the same rows, so signatures alone cannot
        // detect that ABA case. Only discard this Activity's in-memory receipt;
        // the SQL, backup data and unrelated learning writes stay unchanged.
        String normalized=sql.replaceFirst("(?s)^\\s*(?:(?:/\\*.*?\\*/|--[^\\r\\n]*(?:\\r?\\n|$))\\s*)+","").replace('"',' ').replace('`',' ').replace('[',' ').replace(']',' ');
        if(normalized.matches("(?is)\\s*(?:INSERT(?:\\s+OR\\s+\\w+)?\\s+INTO|REPLACE\\s+INTO|UPDATE(?:\\s+OR\\s+\\w+)?|DELETE\\s+FROM|DROP\\s+TABLE(?:\\s+IF\\s+EXISTS)?|ALTER\\s+TABLE)\\s+(?:main\\s*\\.\\s*)?music_imports(?=\\s|\\(|;|$).*"))musicRemoveReceipt=null;
    }

    private void submitWork(Runnable action){
        synchronized(workGate){
            if(erasureScheduled)throw new IllegalStateException("系统正在清理本应用资料");
            activeWorkers++;
            try{worker.execute(()->{try{action.run();}finally{synchronized(workGate){activeWorkers--;}}});}
            catch(RuntimeException e){activeWorkers--;throw e;}
        }
    }
    private JSONArray sqlQuery(JSONObject args)throws Exception{
        if(BuildConfig.COMMERCIAL_EDITION)SqlBridgePolicy.validate("query",args.getString("sql"));
        String sql=args.getString("sql");boolean settingsJson=sql.toLowerCase(Locale.ROOT).matches("(?s).*\\bsettings\\b.*");
        JSONArray values=args.getJSONArray("values");String[] params=new String[values.length()];for(int i=0;i<params.length;i++)params[i]=values.isNull(i)?null:values.get(i).toString();
        JSONArray rows=new JSONArray();try(Cursor cursor=database.rawQuery(sql,params)){while(cursor.moveToNext()){JSONObject row=new JSONObject();for(int i=0;i<cursor.getColumnCount();i++){Object value;switch(cursor.getType(i)){case Cursor.FIELD_TYPE_NULL:value=JSONObject.NULL;break;case Cursor.FIELD_TYPE_INTEGER:value=cursor.getLong(i);break;case Cursor.FIELD_TYPE_FLOAT:value=cursor.getDouble(i);break;default:value=cursor.getString(i);}if(settingsJson&&"json".equalsIgnoreCase(cursor.getColumnName(i))&&value instanceof String)value=redactSettingsJson((String)value);row.put(cursor.getColumnName(i),value);}rows.put(row);}}return rows;
    }

    private JSONObject protectSettingsMutation(JSONObject args)throws Exception{
        String sql=args.getString("sql"),upper=sql.trim().replaceAll("\\s+"," ").toUpperCase(Locale.ROOT).replaceAll("\\( ","(").replaceAll(" \\)",")");
        boolean update=upper.matches("UPDATE SETTINGS SET JSON\\s*=\\s*\\? WHERE ID\\s*=\\s*1");
        boolean insertTwoParams=upper.matches("INSERT(?: OR REPLACE)? INTO SETTINGS \\((?:ID|\"ID\"|`ID`|\\[ID\\])\\s*,\\s*(?:JSON|\"JSON\"|`JSON`|\\[JSON\\])\\) VALUES \\(\\?\\s*,\\s*\\?\\)");
        boolean insertLiteralId=upper.matches("INSERT(?: OR REPLACE)? INTO SETTINGS \\((?:ID|\"ID\"|`ID`|\\[ID\\])\\s*,\\s*(?:JSON|\"JSON\"|`JSON`|\\[JSON\\])\\) VALUES \\(1\\s*,\\s*\\?\\)");
        boolean insert=insertTwoParams||insertLiteralId;
        boolean delete=upper.matches("DELETE FROM SETTINGS(?: WHERE ID\\s*=\\s*1)?");
        if(delete){
            String legacy=legacySettingsKey();
            if(legacy==null)throw new IOException("无法确认模型密钥状态，不能删除设置");
            if(!legacy.isEmpty())throw new IOException("模型密钥尚未迁移，不能删除设置");
        }
        if(!update&&!insert)return args;
        JSONArray values=args.getJSONArray("values");int index=insertTwoParams?1:0;if(values.length()<=index||values.isNull(index))throw new IOException("设置 JSON 无效");
        Object raw=values.get(index);if(!(raw instanceof String))throw new IOException("设置 JSON 无效");JSONObject settings=new JSONObject((String)raw);String key=settings.optString("llmKey","");
        if(!key.isEmpty())throw new IOException("模型密钥只能通过原生模型服务保存");
        String legacy=legacySettingsKey();
        if(legacy==null)throw new IOException("无法确认模型密钥状态，不能改写设置");
        if(!legacy.isEmpty()){
            settings.put("llmKey",legacy);
            // A pending legacy key must keep its original destination too.
            // Appearance changes cannot redirect a later migration/request.
            try(Cursor cursor=database.rawQuery("SELECT json FROM settings WHERE id=1",null)){
                if(!cursor.moveToFirst())throw new IOException("无法确认模型密钥状态，不能改写设置");
                JSONObject previous=new JSONObject(cursor.getString(0));
                settings.put("llmEndpoint",previous.optString("llmEndpoint",""));
                settings.put("llmModel",previous.optString("llmModel","deepseek-chat"));
            }
        }
        JSONObject copy=new JSONObject(args.toString());copy.getJSONArray("values").put(index,settings.toString());return copy;
    }
    private String legacySettingsKey(){try(Cursor cursor=database.rawQuery("SELECT json FROM settings WHERE id=1",null)){if(!cursor.moveToFirst())return "";return new JSONObject(cursor.getString(0)).optString("llmKey","");}catch(Exception ignored){return null;}}
    private static String redactSettingsJson(String value){try{JSONObject json=new JSONObject(value);json.put("llmKey","");return json.toString();}catch(Exception ignored){return "{\"llmKey\":\"\"}";}}

    private JSONObject http(JSONObject args)throws Exception{
        URL url=new URL(args.getString("url"));if(!"https".equals(url.getProtocol()))throw new IOException("平板版的 AI 接口请使用 HTTPS 地址。");
        HttpURLConnection conn=(HttpURLConnection)url.openConnection();
        try{
            conn.setInstanceFollowRedirects(false);conn.setConnectTimeout(15000);conn.setReadTimeout(30000);conn.setRequestMethod(args.optString("method","POST"));
            JSONObject headers=args.optJSONObject("headers");if(headers!=null)for(Iterator<String> it=headers.keys();it.hasNext();){String key=it.next();if(Arrays.asList("authorization","content-type","accept").contains(key.toLowerCase(Locale.ROOT)))conn.setRequestProperty(key,headers.getString(key));}
            if(!args.isNull("body")){byte[] data=args.getString("body").getBytes(StandardCharsets.UTF_8);if(data.length>1024*1024)throw new IOException("请求内容过长");conn.setDoOutput(true);try(OutputStream out=conn.getOutputStream()){out.write(data);}}
            int status=conn.getResponseCode();InputStream stream=status>=400?conn.getErrorStream():conn.getInputStream();String body=stream==null?"":new String(readBounded(stream,2*1024*1024),StandardCharsets.UTF_8);
            return new JSONObject().put("status",status).put("body",body);
        }finally{conn.disconnect();}
    }
    private static byte[] readBounded(InputStream stream,long limit)throws IOException{
        try(InputStream in=stream;ByteArrayOutputStream out=new ByteArrayOutputStream()){byte[] buffer=new byte[16384];long total=0;int n;while((n=in.read(buffer))!=-1){total+=n;if(total>limit)throw new IOException("文件超出大小限制");out.write(buffer,0,n);}return out.toByteArray();}
    }
    private static String hash(byte[] bytes)throws Exception{byte[] digest=MessageDigest.getInstance("SHA-256").digest(bytes);StringBuilder out=new StringBuilder();for(byte b:digest)out.append(String.format(Locale.ROOT,"%02x",b&255));return out.toString();}
    private static String extension(String name){int dot=name.lastIndexOf('.');return dot>=0?name.substring(dot+1).toLowerCase(Locale.ROOT):"";}
    private String displayName(Uri uri){try(Cursor c=getContentResolver().query(uri,new String[]{OpenableColumns.DISPLAY_NAME},null,null,null)){if(c!=null&&c.moveToFirst())return c.getString(0);}catch(Exception ignored){}return "导入文件";}

    private static final class LegacyMusicRow{
        final String id,path,title;final long createdAt;
        LegacyMusicRow(String id,String path,String title,long createdAt){this.id=id;this.path=path;this.title=title;this.createdAt=createdAt;}
    }
    private static final class CopiedFile{final File file;final boolean created;CopiedFile(File file,boolean created){this.file=file;this.created=created;}}

    /** Create the native resource tables before WebView/JS starts and migrate once. */
    private void initializeResourceStore(){
        try{
            database.beginTransaction();
            database.execSQL("CREATE TABLE IF NOT EXISTS music_imports(id TEXT PRIMARY KEY,path TEXT NOT NULL,title TEXT NOT NULL,createdAt INTEGER NOT NULL)");
            database.execSQL("CREATE TABLE IF NOT EXISTS device_resources(key TEXT PRIMARY KEY,value TEXT NOT NULL)");
            database.setTransactionSuccessful();
        }catch(Exception e){
            Log.e("XinhaiResources","无法创建 Android 资源表，保留旧兼容读取",e);
        }finally{try{if(database.inTransaction())database.endTransaction();}catch(Exception ignored){}}
        if(!resourceMigrationReady())try{migrateLegacyResources();}catch(Exception e){
            Log.e("XinhaiResources","旧资源迁移未完成，将继续使用旧偏好；下次启动会重试",e);
            recordResourceMigrationError(e);
        }
    }

    private boolean resourceMigrationReady(){return "1".equals(readResource(RESOURCE_MIGRATION,null));}
    private String readResource(String key,String fallback){
        try(Cursor c=database.rawQuery("SELECT value FROM device_resources WHERE key=?",new String[]{key})){return c.moveToFirst()?c.getString(0):fallback;}
        catch(Exception e){return fallback;}
    }
    private void putResource(String key,String value){
        ContentValues row=new ContentValues();row.put("key",key);row.put("value",value==null?"":value);if(database.insertWithOnConflict("device_resources",null,row,SQLiteDatabase.CONFLICT_REPLACE)<0)throw new SQLiteException("无法保存资源引用: "+key);
    }
    private void deleteResource(String key){database.delete("device_resources","key=?",new String[]{key});}
    private void recordResourceMigrationError(Exception error){
        try{
            database.beginTransaction();putResource(RESOURCE_MIGRATION_ERROR,error.getClass().getSimpleName()+": "+(error.getMessage()==null?"未说明":error.getMessage()));database.setTransactionSuccessful();
        }catch(Exception ignored){}finally{try{if(database.inTransaction())database.endTransaction();}catch(Exception ignored){}}
    }
    private void migrateLegacyResources()throws Exception{
        String rawMusic=preferences.getString("music","[]");
        ArrayList<LegacyMusicRow> music=parseLegacyMusic(rawMusic);
        String legacyTree=preferences.getString("knowledgeTree","");
        database.beginTransaction();
        try{
            for(LegacyMusicRow row:music){ContentValues values=new ContentValues();values.put("id",row.id);values.put("path",row.path);values.put("title",row.title);values.put("createdAt",row.createdAt);if(database.insertWithOnConflict("music_imports",null,values,SQLiteDatabase.CONFLICT_IGNORE)<0)throw new IOException("音乐迁移出现重复条目: "+row.id);}
            putResource(RESOURCE_KNOWLEDGE_TREE,legacyTree==null?"":legacyTree);
            putResource(RESOURCE_KNOWLEDGE_LOCAL_ROOT,"");
            putResource(RESOURCE_MIGRATION,"1");deleteResource(RESOURCE_MIGRATION_ERROR);
            database.setTransactionSuccessful();
        }finally{database.endTransaction();}
    }
    private ArrayList<LegacyMusicRow> parseLegacyMusic(String raw)throws Exception{
        JSONArray rows=new JSONArray(raw==null?"[]":raw);ArrayList<LegacyMusicRow> result=new ArrayList<>();HashSet<String> ids=new HashSet<>();long base=System.currentTimeMillis();
        for(int i=0;i<rows.length();i++){
            JSONObject row=rows.getJSONObject(i);String id=row.optString("id","");if(!id.matches("[a-f0-9]{64}"))throw new IOException("旧音乐条目 ID 无效: "+id);
            if(!ids.add(id))throw new IOException("旧音乐清单含重复 ID: "+id);
            String source=row.optString("file","");File file=legacyMusicFile(source,id);String title=row.optString("title",file.getName());if(title.isEmpty())title=file.getName();long modified=file.exists()?file.lastModified():0;result.add(new LegacyMusicRow(id,file.getCanonicalPath(),title,modified>0?modified:base+i));
        }
        return result;
    }
    private File legacyMusicFile(String source,String id)throws Exception{
        if(source==null||source.isEmpty())throw new IOException("旧音乐条目缺少文件路径");Uri uri=Uri.parse(source);String path=null;
        if("https".equals(uri.getScheme())&&HOST.equals(uri.getHost())&&uri.getPort()==-1&&uri.getQuery()==null&&uri.getFragment()==null)path=uri.getPath();
        File root=new File(getFilesDir(),"music").getCanonicalFile(),file;
        if(path!=null){if(!path.matches("/local/music/"+id+"\\.(?:mp3|ogg|wav|flac|m4a|aac|opus)"))throw new IOException("旧音乐路径无法安全定位");file=new File(root,path.substring("/local/music/".length())).getCanonicalFile();}
        else if(uri.getScheme()==null&&source.startsWith(File.separator))file=new File(source).getCanonicalFile();
        else throw new IOException("旧音乐路径无法安全定位");
        if(!file.getParentFile().equals(root)||!file.getName().startsWith(id+"."))throw new IOException("旧音乐路径越界");return file;
    }
    private String activeKnowledgeTree(){return resourceMigrationReady()?readResource(RESOURCE_KNOWLEDGE_TREE,""):preferences.getString("knowledgeTree","");}
    private String activeKnowledgeLocalRoot(){return resourceMigrationReady()?readResource(RESOURCE_KNOWLEDGE_LOCAL_ROOT,""):"";}

    private void choose(String id,String method,JSONObject args){
        if(erasureScheduled){reply(id,failure(new IOException("系统正在清理本应用资料")));return;}
        if(pendingId!=null){reply(id,failure(new IOException("请先完成当前文件选择。")));return;}
        Intent intent;
        if("knowledgeChoose".equals(method)){intent=new Intent(Intent.ACTION_OPEN_DOCUMENT_TREE);intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION|Intent.FLAG_GRANT_WRITE_URI_PERMISSION|Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION);}
        else if("saveFile".equals(method)){intent=new Intent(Intent.ACTION_CREATE_DOCUMENT).setType(args.optString("defaultName").endsWith(".csv")?"text/csv":"application/json").addCategory(Intent.CATEGORY_OPENABLE).putExtra(Intent.EXTRA_TITLE,args.optString("defaultName","xinhai-export.json"));}
        else if("musicImport".equals(method)){intent=new Intent(Intent.ACTION_OPEN_DOCUMENT).setType("audio/*").addCategory(Intent.CATEGORY_OPENABLE).putExtra(Intent.EXTRA_ALLOW_MULTIPLE,true);}
        else if("backgroundImport".equals(method)){intent=new Intent(Intent.ACTION_OPEN_DOCUMENT).setType("*/*").addCategory(Intent.CATEGORY_OPENABLE).putExtra(Intent.EXTRA_MIME_TYPES,new String[]{"image/png","image/jpeg","image/webp","video/mp4","video/webm"});}
        else if("themeImport".equals(method)){intent=new Intent(Intent.ACTION_OPEN_DOCUMENT).setType("*/*").addCategory(Intent.CATEGORY_OPENABLE).putExtra(Intent.EXTRA_MIME_TYPES,new String[]{"application/zip","application/octet-stream"});}
        else if("themeExport".equals(method)){
            String title="xinhai-theme.xinhai-theme";
            JSONObject manifest=args.optJSONObject("manifest");
            if(manifest!=null){String name=manifest.optString("name","").trim().replaceAll("[<>:\"/\\\\|?*\\x00-\\x1f]","-");if(!name.isEmpty())title=name+".xinhai-theme";}
            intent=new Intent(Intent.ACTION_CREATE_DOCUMENT).setType("application/zip").addCategory(Intent.CATEGORY_OPENABLE).putExtra(Intent.EXTRA_TITLE,title);
        }
        else if("backupExport".equals(method)){
            String title=args.optBoolean("safety",false)?"心海共学当前资料安全副本.xinhai-backup":"心海共学备份.xinhai-backup";
            intent=new Intent(Intent.ACTION_CREATE_DOCUMENT).setType("application/zip").addCategory(Intent.CATEGORY_OPENABLE).putExtra(Intent.EXTRA_TITLE,title);
        }
        else if("backupPrepare".equals(method)){
            intent=new Intent(Intent.ACTION_OPEN_DOCUMENT).setType("*/*").addCategory(Intent.CATEGORY_OPENABLE).putExtra(Intent.EXTRA_MIME_TYPES,new String[]{"application/zip","application/octet-stream"});
        }
        else {reply(id,failure(new IOException("不支持的文件操作")));return;}
        pendingId=id;pendingMethod=method;pendingArgs=args;
        try{startActivityForResult(intent,801);}catch(Exception e){pendingId=null;pendingMethod=null;pendingArgs=null;reply(id,failure(e));}
    }
    @Override protected void onActivityResult(int requestCode,int resultCode,Intent data){
        super.onActivityResult(requestCode,resultCode,data);if(requestCode!=801||pendingId==null)return;
        String id=pendingId,method=pendingMethod;JSONObject args=pendingArgs;pendingId=null;pendingMethod=null;pendingArgs=null;
        submitWork(()->{try{
            if(resultCode!=RESULT_OK||data==null){reply(id,ok("musicImport".equals(method)?new JSONObject().put("added",0).put("skipped",0).put("duplicates",0).put("failed",0).put("tracks",musicList()).put("cancelled",true):null));return;}
            Uri uri=data.getData();Object result;
            if("knowledgeChoose".equals(method)){
                if(uri==null)throw new IOException("未选择文件夹");
                if(!resourceMigrationReady())throw new IOException("资源迁移未完成，已保留旧学习库，请重启后重试。");
                getContentResolver().takePersistableUriPermission(uri,data.getFlags()&(Intent.FLAG_GRANT_READ_URI_PERMISSION|Intent.FLAG_GRANT_WRITE_URI_PERMISSION));
                // Change references and validate the new root in one transaction.
                // A scan failure rolls the references back and restores noteUris
                // from the previous root before the error reaches JS.
                String oldTree=activeKnowledgeTree();
                database.beginTransaction();
                boolean switched=false;
                try{putResource(RESOURCE_KNOWLEDGE_TREE,uri.toString());putResource(RESOURCE_KNOWLEDGE_LOCAL_ROOT,"");result=knowledgeList(uri.toString());database.setTransactionSuccessful();switched=true;}
                finally{database.endTransaction();if(!switched)try{knowledgeList(oldTree);}catch(Exception restore){Log.e("XinhaiResources","恢复旧学习库缓存失败",restore);}}
            }else if("saveFile".equals(method)){
                if(uri==null)throw new IOException("未选择保存位置");try(OutputStream out=getContentResolver().openOutputStream(uri,"wt")){if(out==null)throw new IOException("无法写入文件");out.write(args.getString("content").getBytes(StandardCharsets.UTF_8));}result=displayName(uri);
            }else if("backgroundImport".equals(method)){result=importBackground(uri);}
            else if("themeImport".equals(method)){result=themeFiles.importTheme(uri,displayName(uri));}
            else if("themeExport".equals(method)){
                if(uri==null)throw new IOException("未选择保存位置");
                JSONObject manifest=args.getJSONObject("manifest");
                String wallpaperSrc=args.isNull("wallpaperSrc")?null:args.optString("wallpaperSrc",null);
                result=themeFiles.exportTheme(uri,manifest,wallpaperSrc);
            }
            else if("backupExport".equals(method)){
                if(uri==null)throw new IOException("未选择保存位置");
                if(!resourceMigrationReady())throw new IOException("资源迁移未完成，暂不能创建备份。");
                result=backupFiles.exportArchive(uri,args.getJSONObject("snapshot"),args.optJSONArray("mediaSources"),activeKnowledgeTree(),activeKnowledgeLocalRoot());
            }
            else if("backupPrepare".equals(method)){
                if(uri==null)throw new IOException("未选择备份文件");
                result=backupFiles.prepareArchive(uri,displayName(uri));
            }
            else {
                List<Uri> selected=new ArrayList<>();ClipData clip=data.getClipData();if(clip!=null){for(int i=0;i<clip.getItemCount();i++)selected.add(clip.getItemAt(i).getUri());}else if(uri!=null)selected.add(uri);
                result=importMusic(selected);
            }
            reply(id,ok(result));
        }catch(Exception e){reply(id,failure(e));}});
    }

    private CopiedFile copyImportTracked(Uri uri,String category,Set<String> allowed,long limit)throws Exception{
        if(uri==null)throw new IOException("未选择文件");String name=displayName(uri),ext=extension(name);if(!allowed.contains(ext))throw new IOException("文件格式不支持");
        File folder=new File(getFilesDir(),category);if(!folder.exists()&&!folder.mkdirs())throw new IOException("无法创建导入目录");
        File temporary=new File(folder,UUID.randomUUID()+".part");MessageDigest digest=MessageDigest.getInstance("SHA-256");long total=0;
        try{
            try(InputStream in=getContentResolver().openInputStream(uri);OutputStream out=new FileOutputStream(temporary)){if(in==null)throw new IOException("无法读取文件");byte[] buffer=new byte[65536];int n;while((n=in.read(buffer))!=-1){total+=n;if(total>limit)throw new IOException("文件超出大小限制");digest.update(buffer,0,n);out.write(buffer,0,n);}}
            if(total==0)throw new IOException("文件为空");StringBuilder hex=new StringBuilder();for(byte b:digest.digest())hex.append(String.format(Locale.ROOT,"%02x",b&255));File destination=new File(folder,hex+"."+ext);
            if(destination.exists()){return new CopiedFile(destination,false);}
            if(!temporary.renameTo(destination))throw new IOException("保存导入文件失败");return new CopiedFile(destination,true);
        }finally{if(temporary.exists())temporary.delete();}
    }
    private File copyImport(Uri uri,String category,Set<String> allowed,long limit)throws Exception{return copyImportTracked(uri,category,allowed,limit).file;}
    private JSONObject importBackground(Uri uri)throws Exception{
        return themeFiles.importBackground(uri,displayName(uri));
    }
    private synchronized JSONArray musicList()throws Exception{
        if(!resourceMigrationReady())return legacyMusicListForRenderer();
        JSONArray rows=new JSONArray();
        try(Cursor c=database.rawQuery("SELECT id,path,title FROM music_imports ORDER BY createdAt,id",null)){
            while(c.moveToNext()){
                String id=c.getString(0),path=c.getString(1),title=c.getString(2);File file=safeMusicFile(path,id);if(file==null){Log.e("XinhaiResources","跳过无法安全定位的音乐路径: "+path);continue;}
                rows.put(new JSONObject().put("id",id).put("file",ORIGIN+"/local/music/"+file.getName()).put("title",title).put("tag","local"));
            }
        }
        return rows;
    }
    private JSONArray legacyMusicListForRenderer()throws JSONException{
        JSONArray raw=new JSONArray(preferences.getString("music","[]")),safe=new JSONArray();
        for(int i=0;i<raw.length();i++)try{
            JSONObject row=raw.getJSONObject(i);String id=row.getString("id");File file=legacyMusicFile(row.getString("file"),id);
            safe.put(new JSONObject().put("id",id).put("file",ORIGIN+"/local/music/"+file.getName()).put("title",row.optString("title",file.getName())).put("tag","local"));
        }catch(Exception e){Log.e("XinhaiResources","跳过无法安全展示的旧音乐条目",e);}
        return safe;
    }
    private File safeMusicFile(String path,String id){
        try{File root=new File(getFilesDir(),"music").getCanonicalFile(),file=new File(path).getCanonicalFile();String ticketName="[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-4[0-9a-fA-F]{3}-[89aAbB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}_m[0-9]{6}";if(!file.getParentFile().equals(root)||!file.getName().matches("(?:"+Pattern.quote(id)+"|"+ticketName+")\\.(?:mp3|ogg|wav|flac|m4a|aac|opus)"))return null;return file;}catch(Exception e){return null;}
    }
    private synchronized JSONArray removeMusic(String id)throws Exception{
        if(!resourceMigrationReady()){
            String previous=preferences.getString("music","[]");JSONArray rows=new JSONArray(previous),next=new JSONArray();JSONObject removed=null;int index=-1;
            for(int i=0;i<rows.length();i++){
                JSONObject row=rows.getJSONObject(i);
                if(row.getString("id").equals(id)){if(removed!=null)throw new IOException("音乐列表含重复条目，暂不能安全移出");removed=row;index=i;}
                else next.put(row);
            }
            if(removed==null)return musicList();
            File file=legacyMusicFile(removed.getString("file"),id);
            MusicRemoveReceipt receipt=new MusicRemoveReceipt(id,file.getCanonicalPath(),removed.optString("title",file.getName()),0,removed.toString(),index,true,musicSignature(true,next.toString()));
            saveLegacyMusic(next.toString(),previous);
            musicRemoveReceipt=receipt;
            return musicList();
        }
        if(database.inTransaction())throw new IOException("正在写入音乐资料，请完成后再移出歌曲");
        MusicRemoveReceipt receipt;JSONArray result;
        database.beginTransaction();
        try{
            String path,title;long createdAt;
            try(Cursor c=database.rawQuery("SELECT path,title,createdAt FROM music_imports WHERE id=?",new String[]{id})){
                if(!c.moveToFirst())return musicList();path=c.getString(0);title=c.getString(1);createdAt=c.getLong(2);
            }
            if(database.delete("music_imports","id=?",new String[]{id})!=1)throw new IOException("移出音乐记录失败");
            receipt=new MusicRemoveReceipt(id,path,title,createdAt,null,-1,false,musicSignature(false,null));
            result=musicList();database.setTransactionSuccessful();
        }finally{database.endTransaction();}
        musicRemoveReceipt=receipt;
        return result;
    }
    private String musicSignature(boolean legacy,String raw)throws Exception{
        String value;
        if(legacy)value=new JSONArray(raw==null?preferences.getString("music","[]"):raw).toString();
        else{
            JSONArray rows=new JSONArray();
            try(Cursor c=database.rawQuery("SELECT id,path,title,createdAt FROM music_imports ORDER BY createdAt,id",null)){
                while(c.moveToNext())rows.put(new JSONArray().put(c.getString(0)).put(c.getString(1)).put(c.getString(2)).put(c.getLong(3)));
            }
            value=rows.toString();
        }
        byte[] digest=MessageDigest.getInstance("SHA-256").digest(value.getBytes(StandardCharsets.UTF_8));StringBuilder hex=new StringBuilder();
        for(byte b:digest)hex.append(String.format(Locale.ROOT,"%02x",b&255));return (legacy?"legacy:":"database:")+hex;
    }
    private void saveLegacyMusic(String next,String previous)throws IOException{
        if(!preferences.edit().putString("music",next).commit()){
            // SharedPreferences may update memory even when disk commit fails.
            // Put the previous list back before reporting failure; never create
            // or consume an undo receipt for an unsuccessful write.
            preferences.edit().putString("music",previous).commit();
            throw new IOException("保存音乐列表失败");
        }
    }
    private synchronized JSONArray undoRemoveMusic(String id)throws Exception{
        MusicRemoveReceipt receipt=musicRemoveReceipt;
        if(receipt==null||!receipt.id.equals(id))throw new IOException("只能撤销本次打开应用后最近移出的歌曲");
        if(receipt.legacy==resourceMigrationReady())throw new IOException("音乐库已变化，不能撤销上次移出");
        if(receipt.legacy){
            String current=preferences.getString("music","[]");
            if(!receipt.afterSignature.equals(musicSignature(true,current)))throw new IOException("音乐库已变化，不能撤销上次移出");
            JSONObject original=new JSONObject(receipt.legacyEntry);File file=legacyMusicFile(original.getString("file"),receipt.id);
            if(!file.isFile()||!file.canRead())throw new IOException("保留的音乐副本已不在本机，不能撤销");
            JSONArray rows=new JSONArray(current),next=new JSONArray();
            if(receipt.legacyIndex<0||receipt.legacyIndex>rows.length())throw new IOException("原音乐排序已变化，不能撤销");
            for(int i=0;i<=rows.length();i++){if(i==receipt.legacyIndex)next.put(original);if(i<rows.length())next.put(rows.get(i));}
            saveLegacyMusic(next.toString(),current);musicRemoveReceipt=null;return musicList();
        }
        if(database.inTransaction())throw new IOException("正在写入音乐资料，请完成后再撤销");
        JSONArray result;database.beginTransaction();
        try{
            if(!receipt.afterSignature.equals(musicSignature(false,null)))throw new IOException("音乐库已变化，不能撤销上次移出");
            File file=safeMusicFile(receipt.path,receipt.id);
            if(file==null||!file.isFile()||!file.canRead())throw new IOException("保留的音乐副本已不在本机，不能撤销");
            ContentValues values=new ContentValues();values.put("id",receipt.id);values.put("path",receipt.path);values.put("title",receipt.title);values.put("createdAt",receipt.createdAt);
            database.insertOrThrow("music_imports",null,values);result=musicList();database.setTransactionSuccessful();
        }finally{database.endTransaction();}
        musicRemoveReceipt=null;return result;
    }
    private synchronized JSONObject importMusic(List<Uri> uris)throws Exception{
        if(!resourceMigrationReady()){
            String previous=preferences.getString("music","[]");JSONArray list=new JSONArray(previous);int added=0,duplicates=0,failed=0;
            for(Uri uri:uris){try{File file=copyImport(uri,"music",MUSIC_EXTENSIONS,512L*1024*1024);String id=file.getName().split("\\.")[0];boolean duplicate=false;for(int i=0;i<list.length();i++)if(list.getJSONObject(i).getString("id").equals(id))duplicate=true;if(duplicate){duplicates++;continue;}list.put(new JSONObject().put("id",id).put("file",ORIGIN+"/local/music/"+file.getName()).put("title",displayName(uri)).put("tag","local"));added++;}catch(Exception e){failed++;}}
            saveLegacyMusic(list.toString(),previous);if(added>0)musicRemoveReceipt=null;
            return new JSONObject().put("added",added).put("skipped",duplicates+failed).put("duplicates",duplicates).put("failed",failed).put("tracks",musicList());
        }
        int added=0,duplicates=0,failed=0;ArrayList<CopiedFile> pendingFiles=new ArrayList<>();ArrayList<JSONObject> pendingRows=new ArrayList<>();HashSet<String> pendingIds=new HashSet<>();
        for(Uri uri:uris){try{
            CopiedFile copied=copyImportTracked(uri,"music",MUSIC_EXTENSIONS,512L*1024*1024);String id=copied.file.getName().split("\\.")[0];boolean duplicate=false;try(Cursor c=database.rawQuery("SELECT 1 FROM music_imports WHERE id=?",new String[]{id})){duplicate=c.moveToFirst();}
            if(duplicate){duplicates++;continue;}
            if(!pendingIds.add(id)){duplicates++;continue;}
            pendingFiles.add(copied);pendingRows.add(new JSONObject().put("id",id).put("path",copied.file.getCanonicalPath()).put("title",displayName(uri)).put("createdAt",System.currentTimeMillis()));
        }catch(Exception e){failed++;}}
        try{
            database.beginTransaction();
            for(JSONObject row:pendingRows){ContentValues values=new ContentValues();values.put("id",row.getString("id"));values.put("path",row.getString("path"));values.put("title",row.getString("title"));values.put("createdAt",row.getLong("createdAt"));long inserted=database.insertWithOnConflict("music_imports",null,values,SQLiteDatabase.CONFLICT_IGNORE);if(inserted<0){boolean duplicate;try(Cursor c=database.rawQuery("SELECT 1 FROM music_imports WHERE id=?",new String[]{row.getString("id")})){duplicate=c.moveToFirst();}if(duplicate){duplicates++;continue;}throw new IOException("保存音乐记录失败");}added++;}
            database.setTransactionSuccessful();
        }catch(Exception e){for(CopiedFile copied:pendingFiles)if(copied.created)copied.file.delete();throw e;
        }finally{if(database.inTransaction())database.endTransaction();}
        if(added>0)musicRemoveReceipt=null;
        return new JSONObject().put("added",added).put("skipped",duplicates+failed).put("duplicates",duplicates).put("failed",failed).put("tracks",musicList());
    }

    private File knowledgeDir()throws IOException{
        File filesRoot=getFilesDir().getCanonicalFile();String configured=activeKnowledgeLocalRoot();File dir=(configured==null||configured.isEmpty())?new File(filesRoot,"knowledge"):new File(configured);File canonical=dir.getCanonicalFile();
        if(!canonical.getPath().startsWith(filesRoot.getPath()+File.separator))throw new IOException("本机学习库必须位于应用私有目录");
        if(!canonical.exists()&&!canonical.mkdirs())throw new IOException("无法打开学习库");if(!canonical.isDirectory())throw new IOException("本机学习库路径无效");return canonical;
    }
    private synchronized JSONObject knowledgeList()throws Exception{
        return knowledgeList(activeKnowledgeTree());
    }
    private synchronized JSONObject knowledgeList(String tree)throws Exception{
        JSONArray notes=new JSONArray();skippedNotes=0;noteUris.clear();noteParents.clear();List<KnowledgeCandidate> candidates=new ArrayList<>();
        if(tree.isEmpty())scanLocal(knowledgeDir(),"",candidates,0);else{Uri root=Uri.parse(tree);scanTree(root,DocumentsContract.getTreeDocumentId(root),"",candidates,0);}
        candidates.sort((a,b)->{int time=Long.compare(b.modified,a.modified);return time!=0?time:a.path.compareTo(b.path);});
        for(KnowledgeCandidate candidate:candidates){
            if(notes.length()>=2000){skippedNotes++;continue;}
            try{byte[] bytes=readBounded(candidate.file!=null?new FileInputStream(candidate.file):getContentResolver().openInputStream(candidate.uri),2*1024*1024);notes.put(note(candidate.path,bytes,candidate.modified));}
            catch(IOException failure){skippedNotes++;}
        }
        return new JSONObject().put("root",tree.isEmpty()?"本机学习库":tree).put("notes",notes).put("skipped",skippedNotes);
    }
    private String currentKnowledgeRoot(){String tree=activeKnowledgeTree();return tree.isEmpty()?"本机学习库":tree;}
    private String knowledgeCategory(String root,String path){try(Cursor cursor=database.rawQuery("SELECT category_id FROM local_knowledge_categories WHERE root=? AND path=?",new String[]{root,path})){return cursor.moveToFirst()?cursor.getString(0):null;}}
    private JSONObject note(String path,byte[] bytes,long modified)throws Exception{return new JSONObject().put("path",path).put("title",path.substring(path.lastIndexOf('/')+1).replaceFirst("(?i)\\.md$","")).put("content",new String(bytes,StandardCharsets.UTF_8)).put("revision",hash(bytes)).put("modifiedAt",modified).put("categoryId",knowledgeCategory(currentKnowledgeRoot(),path)==null?JSONObject.NULL:knowledgeCategory(currentKnowledgeRoot(),path));}
    private static final class KnowledgeCandidate{final String path;final File file;final Uri uri;final long modified;KnowledgeCandidate(String path,File file,Uri uri,long modified){this.path=path;this.file=file;this.uri=uri;this.modified=modified;}}
    private void scanLocal(File dir,String prefix,List<KnowledgeCandidate> notes,int depth)throws Exception{
        if(depth>12){skippedNotes++;return;}File[] files=dir.listFiles();if(files==null)throw new IOException("无法读取学习库");
        for(File file:files){if(file.getName().startsWith("."))continue;if(!file.getCanonicalPath().equals(file.getAbsolutePath())){skippedNotes++;continue;}String path=prefix+file.getName();if(file.isDirectory())scanLocal(file,path+"/",notes,depth+1);else if(path.toLowerCase(Locale.ROOT).endsWith(".md")){if(file.length()>2*1024*1024){skippedNotes++;continue;}notes.add(new KnowledgeCandidate(path,file,null,file.lastModified()));}}
    }
    private void scanTree(Uri tree,String documentId,String prefix,List<KnowledgeCandidate> notes,int depth)throws Exception{
        if(depth>12){skippedNotes++;return;}
        String[] columns={DocumentsContract.Document.COLUMN_DOCUMENT_ID,DocumentsContract.Document.COLUMN_DISPLAY_NAME,DocumentsContract.Document.COLUMN_MIME_TYPE,DocumentsContract.Document.COLUMN_SIZE,DocumentsContract.Document.COLUMN_LAST_MODIFIED};
        Uri children=DocumentsContract.buildChildDocumentsUriUsingTree(tree,documentId);
        try(Cursor c=getContentResolver().query(children,columns,null,null,null)){if(c==null)throw new IOException("无法读取授权文件夹，请重新选择。");while(c.moveToNext()){
            String id=c.getString(0),name=c.getString(1),mime=c.getString(2),path=prefix+name;if(name.startsWith("."))continue;
            if(DocumentsContract.Document.MIME_TYPE_DIR.equals(mime))scanTree(tree,id,path+"/",notes,depth+1);
            else if(name.toLowerCase(Locale.ROOT).endsWith(".md")){if(c.getLong(3)>2*1024*1024){skippedNotes++;continue;}Uri uri=DocumentsContract.buildDocumentUriUsingTree(tree,id);noteUris.put(path,uri);noteParents.put(path,documentId);notes.add(new KnowledgeCandidate(path,null,uri,c.getLong(4)));}
        }}
    }
    private synchronized JSONObject knowledgeSave(JSONObject input)throws Exception{
        String path=input.getString("path"),content=input.getString("content");byte[] bytes=content.getBytes(StandardCharsets.UTF_8);
        if(bytes.length>2*1024*1024||path.startsWith("/")||path.contains("\\")||Arrays.asList(path.split("/")).contains("..")||!path.toLowerCase(Locale.ROOT).endsWith(".md"))throw new IOException("笔记路径无效或超过 2MB");
        String revision=input.isNull("revision")?null:input.getString("revision"),tree=activeKnowledgeTree();
        if(tree.isEmpty()){
            File root=knowledgeDir(),file=new File(root,path);if(!file.getCanonicalPath().startsWith(root.getCanonicalPath()+File.separator))throw new IOException("笔记必须位于学习库内");
            boolean exists=file.exists();if(revision==null&&exists)throw new IOException("同名笔记已存在");
            if(revision!=null&&(!exists||!hash(readBounded(new FileInputStream(file),2*1024*1024)).equals(revision)))throw new IOException("笔记已在外部修改，请先另存当前内容，再刷新。");
            File temp=new File(file.getParentFile(),UUID.randomUUID()+".tmp");try{try(FileOutputStream out=new FileOutputStream(temp)){out.write(bytes);out.getFD().sync();}if(!temp.renameTo(file))throw new IOException("保存笔记失败");}finally{if(temp.exists())temp.delete();}
            return note(path,bytes,file.lastModified());
        }
        knowledgeList();Uri uri=noteUris.get(path);
        if(revision==null&&uri!=null)throw new IOException("同名笔记已存在");
        byte[] previous=null;
        if(revision!=null){if(uri==null)throw new IOException("笔记已移动或删除，请另存后刷新。");previous=readBounded(getContentResolver().openInputStream(uri),2*1024*1024);if(!hash(previous).equals(revision))throw new IOException("笔记已在外部修改，请先另存当前内容，再刷新。");}
        boolean created=uri==null;
        if(created){if(path.contains("/"))throw new IOException("请在所选文件夹的顶层创建新笔记。");uri=createKnowledgeDocument(tree,path);}
        try{writeUri(uri,bytes);}catch(Exception e){try{if(previous!=null)writeUri(uri,previous);else if(created)DocumentsContract.deleteDocument(getContentResolver(),uri);}catch(Exception ignored){}throw e;}
        noteUris.put(path,uri);return note(path,bytes,System.currentTimeMillis());
    }
    private void writeUri(Uri uri,byte[] bytes)throws IOException{try(OutputStream out=getContentResolver().openOutputStream(uri,"wt")){if(out==null)throw new IOException("无法写入笔记");out.write(bytes);out.flush();}}
    private Uri createKnowledgeDocument(String tree,String name)throws Exception{
        Uri treeUri=Uri.parse(tree);String rootId=DocumentsContract.getTreeDocumentId(treeUri);
        return createKnowledgeDocumentAt(tree,rootId,name);
    }
    private Uri createKnowledgeDocumentAt(String tree,String rootId,String name)throws Exception{
        Uri treeUri=Uri.parse(tree);
        Uri children=DocumentsContract.buildChildDocumentsUriUsingTree(treeUri,rootId);
        HashSet<String> previousIds=new HashSet<>();
        // The normal note list skips oversized/unreadable files. Check every
        // direct child before creating so skipped files still reserve a name.
        try(Cursor c=getContentResolver().query(children,new String[]{DocumentsContract.Document.COLUMN_DOCUMENT_ID,DocumentsContract.Document.COLUMN_DISPLAY_NAME},null,null,null)){
            if(c==null)throw new IOException("无法检查文件夹中的现有名称，未创建笔记。");
            while(c.moveToNext()){
                previousIds.add(c.getString(0));
                if(name.equalsIgnoreCase(c.getString(1)))throw new IOException("同名笔记或文件夹已存在，请换一个名称。");
            }
        }
        Uri created=DocumentsContract.createDocument(getContentResolver(),DocumentsContract.buildDocumentUriUsingTree(treeUri,rootId),"text/markdown",name);
        if(created==null)throw new IOException("无法创建笔记");
        if(previousIds.contains(DocumentsContract.getDocumentId(created)))throw new IOException("存储服务返回了已有文件，未写入正文。请刷新后重试。");
        try{
            try(Cursor c=getContentResolver().query(created,new String[]{DocumentsContract.Document.COLUMN_DISPLAY_NAME},null,null,null)){
                if(c==null||!c.moveToFirst()||!name.equals(c.getString(0)))throw new IOException("存储服务更改了文件名，未写入正文。请换一个名称重试。");
            }
        }catch(Exception error){try{DocumentsContract.deleteDocument(getContentResolver(),created);}catch(Exception ignored){}throw error;}
        return created;
    }
    private synchronized JSONObject knowledgeCreate(String title,String initialContent,String expectedRoot)throws Exception{
        String currentTree=activeKnowledgeTree();String currentRoot=currentTree.isEmpty()?"本机学习库":currentTree;
        if(expectedRoot!=null&&!expectedRoot.equals(currentRoot))throw new IOException("知识库已切换，未创建笔记。请回到原库确认草稿后重试。");
        String name=title.trim().replaceAll("[<>:\"/\\\\|?*\\x00-\\x1f]","-").replaceAll("[. ]+$","");if(name.length()>100)name=name.substring(0,100);if(name.isEmpty())throw new IOException("请输入笔记标题");
        return knowledgeSave(new JSONObject().put("path",name+".md").put("content",initialContent==null?"# "+title.trim()+"\n\n":initialContent).put("revision",JSONObject.NULL));
    }

    private File knowledgeFile(String path)throws Exception{
        File root=knowledgeDir(),file=new File(root,path);
        if(!file.getCanonicalPath().startsWith(root.getCanonicalPath()+File.separator)||!file.getCanonicalPath().equals(file.getAbsolutePath()))throw new IOException("笔记必须位于学习库内，不能是符号链接");
        return file;
    }
    private byte[] knowledgeBytes(String path,String tree)throws Exception{
        if(tree.isEmpty()){File file=knowledgeFile(path);if(!file.isFile())throw new IOException("笔记已移动或删除，请刷新后重试。");return readBounded(new FileInputStream(file),2*1024*1024);}
        Uri uri=noteUris.get(path);if(uri==null)throw new IOException("笔记已移动、删除或超出读取范围，请刷新后重试。");
        return readBounded(getContentResolver().openInputStream(uri),2*1024*1024);
    }
    private byte[] checkedKnowledgeTarget(JSONObject input)throws Exception{
        String tree=activeKnowledgeTree(),root=tree.isEmpty()?"本机学习库":tree,path=input.getString("path");
        if(!root.equals(input.getString("expectedRoot")))throw new IOException("知识库已切换，未修改笔记。请回到原库后重试。");
        if(path.startsWith("/")||path.contains("\\")||path.matches(".*[\\x00-\\x1f].*")||!path.toLowerCase(Locale.ROOT).endsWith(".md"))throw new IOException("笔记路径无效");
        for(String part:path.split("/",-1))if(part.isEmpty()||part.equals(".")||part.equals(".."))throw new IOException("笔记路径无效");
        knowledgeList();byte[] bytes=knowledgeBytes(path,tree);
        if(!hash(bytes).equals(input.getString("revision")))throw new IOException("笔记已在外部修改。请保留当前草稿，刷新后重试。");
        return bytes;
    }
    private synchronized JSONObject knowledgeSetCategory(JSONObject input)throws Exception{
        byte[] bytes=checkedKnowledgeTarget(input);String path=input.getString("path"),root=currentKnowledgeRoot();
        if(!input.has("categoryId")||!input.has("expectedCategoryId"))throw new IOException("分类参数不完整，请刷新后重试。");
        Object categoryValue=input.get("categoryId"),expectedValue=input.get("expectedCategoryId");
        if(categoryValue!=JSONObject.NULL&&!(categoryValue instanceof String)||expectedValue!=JSONObject.NULL&&!(expectedValue instanceof String))throw new IOException("分类参数无效。");
        String category=categoryValue==JSONObject.NULL?null:(String)categoryValue,expected=expectedValue==JSONObject.NULL?null:(String)expectedValue;
        database.beginTransaction();try{
            String current=knowledgeCategory(root,path);if(!Objects.equals(current,expected))throw new IOException("笔记分类已变化，请刷新后重试。");
            if(category!=null){
                if(!category.matches("(?i)^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$"))throw new IOException("分类编号无效。");
                try(Cursor cursor=database.rawQuery("SELECT archived_at FROM learning_categories WHERE id=?",new String[]{category})){
                    if(!cursor.moveToFirst())throw new IOException("分类已不存在，请刷新后重试。");
                    if(!cursor.isNull(0)&&!Objects.equals(category,current))throw new IOException("此分类已停用，请选择启用的分类。");
                }
            }
            database.execSQL("DELETE FROM local_knowledge_categories WHERE root=? AND path=?",new Object[]{root,path});
            if(category!=null)database.execSQL("INSERT INTO local_knowledge_categories(root,path,category_id) VALUES(?,?,?)",new Object[]{root,path,category});
            database.setTransactionSuccessful();
        }finally{database.endTransaction();}
        return note(path,bytes,activeKnowledgeTree().isEmpty()?knowledgeFile(path).lastModified():System.currentTimeMillis());
    }
    private void copyKnowledgeCategory(String root,String oldPath,String newPath)throws IOException{
        database.beginTransaction();try{
            if(knowledgeCategory(root,newPath)!=null)throw new IOException("目标标题已有分类记录，未覆盖，请换一个标题。");
            String category=knowledgeCategory(root,oldPath);
            if(category!=null)database.execSQL("INSERT INTO local_knowledge_categories(root,path,category_id) VALUES(?,?,?)",new Object[]{root,newPath,category});
            database.setTransactionSuccessful();
        }finally{database.endTransaction();}
    }
    private void removeKnowledgeCategory(String root,String path){database.execSQL("DELETE FROM local_knowledge_categories WHERE root=? AND path=?",new Object[]{root,path});}
    private synchronized JSONObject knowledgeRename(JSONObject input)throws Exception{
        byte[] bytes=checkedKnowledgeTarget(input);String path=input.getString("path"),tree=activeKnowledgeTree(),revision=input.getString("revision");
        String title=input.getString("title").trim().replaceFirst("(?i)\\.md$","");
        if(title.isEmpty()||title.length()>100||title.matches(".*[<>:\"/\\\\|?*\\x00-\\x1f].*")||title.matches(".*[. ]$")||title.matches("(?i)^(con|prn|aux|nul|com[0-9]|lpt[0-9])(?:\\..*)?$"))throw new IOException("请使用有效的笔记标题（最多 100 字，不含路径或特殊符号）");
        String name=title+".md",next=path.substring(0,path.lastIndexOf('/')+1)+name;
        if(next.equals(path))return note(path,bytes,System.currentTimeMillis());
        boolean caseOnly=next.equalsIgnoreCase(path);
        String categoryRoot=currentKnowledgeRoot();if(knowledgeCategory(categoryRoot,next)!=null)throw new IOException("目标标题已有分类记录，未覆盖，请换一个标题。");
        if(tree.isEmpty()){
            File original=knowledgeFile(path),target=knowledgeFile(next);File[] siblings=original.getParentFile().listFiles();if(siblings==null)throw new IOException("无法检查现有文件名，未修改笔记。");
            // Private Android storage is case-sensitive: exclude only the exact
            // original entry, then keep the ordinary exclusive-copy safeguards.
            for(File sibling:siblings)if(sibling.getName().equalsIgnoreCase(name)&&(!caseOnly||!sibling.getName().equals(original.getName())))throw new IOException("同名笔记或文件夹已存在，请换一个标题。");
            if(!target.createNewFile())throw new IOException("同名笔记已存在，请换一个标题。");
            try(FileOutputStream out=new FileOutputStream(target)){out.write(bytes);out.getFD().sync();}catch(Exception failure){target.delete();throw failure;}
            if(!hash(readBounded(new FileInputStream(target),2*1024*1024)).equals(revision)||!hash(knowledgeBytes(path,tree)).equals(revision))throw new IOException("改名期间文件发生变化；原文件和新副本均保留，请刷新后核对。");
            copyKnowledgeCategory(categoryRoot,path,next);
            if(!original.delete())throw new IOException("新标题的副本已保存，但原文件未能移除。两份文件均保留，请刷新后处理。");
            removeKnowledgeCategory(categoryRoot,path);
            return note(next,bytes,target.lastModified());
        }
        Uri original=noteUris.get(path);String parent=noteParents.get(path);if(parent==null)throw new IOException("无法核对原笔记文件夹，未改名。");
        if(caseOnly){
            // A SAF provider may use a case-insensitive filesystem. Creating a
            // second document can return the original, so rename that document
            // through the provider instead of copying/deleting its alias.
            String originalId=DocumentsContract.getDocumentId(original),oldName=path.substring(path.lastIndexOf('/')+1);boolean found=false;
            HashSet<String> siblingIds=new HashSet<>();
            Uri children=DocumentsContract.buildChildDocumentsUriUsingTree(Uri.parse(tree),parent);
            try(Cursor c=getContentResolver().query(children,new String[]{DocumentsContract.Document.COLUMN_DOCUMENT_ID,DocumentsContract.Document.COLUMN_DISPLAY_NAME,DocumentsContract.Document.COLUMN_FLAGS},null,null,null)){
                if(c==null)throw new IOException("无法核对文件夹，未修改大小写。");
                while(c.moveToNext()){
                    String id=c.getString(0),displayName=c.getString(1);siblingIds.add(id);
                    if(originalId.equals(id)){
                        if(!oldName.equals(displayName))throw new IOException("原笔记标题已变化，请刷新后重试。");
                        if((c.getInt(2)&DocumentsContract.Document.FLAG_SUPPORTS_RENAME)==0)throw new IOException("此存储服务不支持安全修改文件名大小写，请在原文件管理器中处理。");
                        found=true;
                    }else if(name.equalsIgnoreCase(displayName))throw new IOException("同名笔记或文件夹已存在，请换一个标题。");
                }
            }
            if(!found)throw new IOException("原笔记已移动或删除，请刷新后重试。");
            copyKnowledgeCategory(categoryRoot,path,next);
            Uri renamed;
            try{
                renamed=DocumentsContract.renameDocument(getContentResolver(),original,name);
                if(renamed==null)throw new IOException("存储服务未返回改名结果。");
            }catch(Exception failure){
                // Clean the staged row only when readback proves the provider
                // left the original name and body intact. Never delete a file.
                try(Cursor c=getContentResolver().query(original,new String[]{DocumentsContract.Document.COLUMN_DISPLAY_NAME},null,null,null)){
                    if(c!=null&&c.moveToFirst()&&oldName.equals(c.getString(0))&&hash(readBounded(getContentResolver().openInputStream(original),2*1024*1024)).equals(revision))removeKnowledgeCategory(categoryRoot,next);
                }catch(Exception ignored){}
                throw new IOException("大小写修改未完成；正文未重写，原分类记录已保留，请刷新后核对。",failure);
            }
            String renamedId=DocumentsContract.getDocumentId(renamed);
            if(siblingIds.contains(renamedId)&&!originalId.equals(renamedId))throw new IOException("存储服务返回了其他文件，未写入或删除正文。原分类记录已保留，请刷新核对。");
            try(Cursor c=getContentResolver().query(renamed,new String[]{DocumentsContract.Document.COLUMN_DISPLAY_NAME},null,null,null)){
                if(c==null||!c.moveToFirst()||!name.equals(c.getString(0)))throw new IOException("存储服务未保留所选大小写；原分类记录已保留，请刷新核对。");
            }
            byte[] renamedBytes=readBounded(getContentResolver().openInputStream(renamed),2*1024*1024);
            if(!hash(renamedBytes).equals(revision))throw new IOException("改名期间正文发生变化；文件与原分类记录已保留，请刷新后核对。");
            noteUris.remove(path);noteParents.remove(path);noteUris.put(next,renamed);noteParents.put(next,parent);
            removeKnowledgeCategory(categoryRoot,path);
            return note(next,renamedBytes,System.currentTimeMillis());
        }
        Uri target=createKnowledgeDocumentAt(tree,parent,name);
        try{writeUri(target,bytes);}catch(Exception failure){try{DocumentsContract.deleteDocument(getContentResolver(),target);}catch(Exception ignored){}throw failure;}
        if(!hash(readBounded(getContentResolver().openInputStream(target),2*1024*1024)).equals(revision)||!hash(knowledgeBytes(path,tree)).equals(revision))throw new IOException("改名期间文件发生变化；原文件和新副本均保留，请刷新后核对。");
        copyKnowledgeCategory(categoryRoot,path,next);
        if(!DocumentsContract.deleteDocument(getContentResolver(),original))throw new IOException("新标题的副本已保存，但原文件未能移除。两份文件均保留，请刷新后处理。");
        removeKnowledgeCategory(categoryRoot,path);
        noteUris.remove(path);noteParents.remove(path);noteUris.put(next,target);noteParents.put(next,parent);
        return note(next,bytes,System.currentTimeMillis());
    }
    private synchronized void knowledgeDelete(JSONObject input)throws Exception{
        if(!"删除笔记".equals(input.optString("confirmation")))throw new IOException("请明确确认删除这篇笔记。");
        checkedKnowledgeTarget(input);String path=input.getString("path"),tree=activeKnowledgeTree();
        boolean deleted=tree.isEmpty()?knowledgeFile(path).delete():DocumentsContract.deleteDocument(getContentResolver(),noteUris.get(path));
        if(!deleted)throw new IOException("笔记未能删除，请检查文件权限后重试。");
        removeKnowledgeCategory(currentKnowledgeRoot(),path);
        noteUris.remove(path);noteParents.remove(path);
    }

    private WebResourceResponse resource(WebResourceRequest request){
        Uri mediaUri=request.getUrl();String mediaHost=mediaUri.getHost();
        if(!BuildConfig.COMMERCIAL_EDITION&&!request.isForMainFrame()&&"https".equals(mediaUri.getScheme())&&mediaHost!=null&&mediaHost.matches("(?:[a-zA-Z0-9-]+\\.)*music\\.(126\\.net|163\\.com)")&&mediaUri.getPort()==-1)return null;
        Uri uri=request.getUrl();if(!HOST.equals(uri.getHost())||!"https".equals(uri.getScheme()))return new WebResourceResponse("text/plain","UTF-8",403,"Forbidden",new HashMap<>(),new ByteArrayInputStream(new byte[0]));
        try{
            String path=uri.getPath();if(path==null||path.contains("..")||path.contains("\\"))throw new IOException("Invalid path");if(path.equals("/"))path="/mobile.html";
            InputStream stream;long size;String ext=extension(path);String mime=mime(ext);
            if(path.startsWith("/local/")){
                String relative=path.substring(7);if(!relative.matches("(?:music|backgrounds)/[A-Za-z0-9_-]{1,128}\\.[a-z0-9]+"))throw new IOException("Invalid media path");File file=new File(getFilesDir(),relative);size=file.length();stream=new FileInputStream(file);
            }else{
                String asset=path.substring(1);try{AssetFileDescriptor fd=getAssets().openFd(asset);size=fd.getLength();stream=fd.createInputStream();}catch(IOException compressed){byte[] data=readBounded(getAssets().open(asset),24*1024*1024);size=data.length;stream=new ByteArrayInputStream(data);}
            }
            Map<String,String> headers=new HashMap<>();headers.put("Accept-Ranges","bytes");headers.put("Cache-Control","no-cache");headers.put("X-Content-Type-Options","nosniff");
            if("html".equals(ext))headers.put("Content-Security-Policy","default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; media-src 'self' blob: https://*.music.126.net https://*.music.163.com; connect-src 'self'; font-src 'self' data:; object-src 'none'; base-uri 'none'; frame-src 'none'");
            String range=request.getRequestHeaders().get("Range");if(range==null)range=request.getRequestHeaders().get("range");long endExclusive=size;
            if(range!=null){
                try{long[] bounds=mediaRange(range,size);endExclusive=bounds[1]+1;headers.put("Content-Range","bytes "+bounds[0]+"-"+bounds[1]+"/"+size);}
                catch(IOException invalid){stream.close();headers.put("Content-Range","bytes */"+size);return new WebResourceResponse(mime,null,416,"Range Not Satisfiable",headers,new ByteArrayInputStream(new byte[0]));}
            }
            // Android WebView's stream loader already applies the request Range
            // to the supplied stream and derives Content-Length. Supply the
            // whole resource starting at zero: manually skipping here moves the
            // position twice. Stop reads at the absolute end of a bounded range;
            // WebView seeks its start but does not itself truncate the body.
            return new WebResourceResponse(mime,Arrays.asList("html","css","js","json","svg").contains(ext)?"UTF-8":null,range==null?200:206,range==null?"OK":"Partial Content",headers,new RangeBodyStream(stream,size,endExclusive));
        }catch(Exception e){return new WebResourceResponse("text/plain","UTF-8",404,"Not Found",new HashMap<>(),new ByteArrayInputStream(new byte[0]));}
    }
    private static long[] mediaRange(String value,long size)throws IOException{
        if(size<=0||!value.matches("bytes=\\d*-\\d*"))throw new IOException("Invalid range");
        String[] pair=value.substring(6).split("-",-1);
        try{
            if(pair[0].isEmpty()){
                if(pair[1].isEmpty())throw new IOException("Invalid range");
                long count=Long.parseLong(pair[1]);if(count<=0)throw new IOException("Invalid range");
                return new long[]{Math.max(0,size-count),size-1};
            }
            long start=Long.parseLong(pair[0]),end=pair[1].isEmpty()?size-1:Math.min(size-1,Long.parseLong(pair[1]));
            if(start>=size||end<start)throw new IOException("Invalid range");
            return new long[]{start,end};
        }catch(NumberFormatException invalid){throw new IOException("Invalid range",invalid);}
    }
    private static final class RangeBodyStream extends FilterInputStream{
        private final long size,end;private long position;
        RangeBodyStream(InputStream stream,long size,long end){super(stream);this.size=size;this.end=end;}
        // WebView computes the requested range against the complete resource,
        // then calls skip(start). Advertise that size without pre-seeking it.
        @Override public int available(){return (int)Math.min(Integer.MAX_VALUE,Math.max(0,size-position));}
        @Override public long skip(long count)throws IOException{
            if(count<=0||position>=end)return 0;
            long skipped=in.skip(Math.min(count,end-position));position+=skipped;return skipped;
        }
        @Override public int read()throws IOException{
            if(position>=end)return -1;int value=in.read();if(value>=0)position++;return value;
        }
        @Override public int read(byte[] bytes,int offset,int length)throws IOException{
            if(bytes==null)throw new NullPointerException();
            if(offset<0||length<0||offset>bytes.length-length)throw new IndexOutOfBoundsException();
            if(length==0)return 0;if(position>=end)return -1;
            int count=in.read(bytes,offset,(int)Math.min(length,end-position));if(count>0)position+=count;return count;
        }
        @Override public boolean markSupported(){return false;}
        @Override public synchronized void reset()throws IOException{throw new IOException("Range stream does not support reset");}
    }
    private static String mime(String ext){switch(ext){case "html":return "text/html";case "js":return "application/javascript";case "css":return "text/css";case "json":return "application/json";case "svg":return "image/svg+xml";case "png":return "image/png";case "jpg":case "jpeg":return "image/jpeg";case "webp":return "image/webp";case "mp4":return "video/mp4";case "webm":return "video/webm";case "ogg":return "audio/ogg";case "mp3":return "audio/mpeg";case "wav":return "audio/wav";case "m4a":return "audio/mp4";case "ttf":return "font/ttf";case "woff2":return "font/woff2";default:return "application/octet-stream";}}
}
