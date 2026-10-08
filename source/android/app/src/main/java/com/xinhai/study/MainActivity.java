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
    private int skippedNotes=0;

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
    @Override protected void onResume(){super.onResume();if(web!=null){web.onResume();web.evaluateJavascript("window.dispatchEvent(new Event('xinhai-resume'))",null);}}
    @Override public void onBackPressed(){web.evaluateJavascript("(()=>{const b=document.querySelector('.restore-ui');if(b){b.click();return}const active=document.activeElement;if(active&&/INPUT|TEXTAREA/.test(active.tagName)){active.blur();return}const home=document.querySelector('.command-item');if(home&&!home.classList.contains('is-active')){home.click();return}window.XinhaiNative.call('minimize','{}')})()",null);}
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
        if(clientStateStore==null)throw new IOException("此客户端存储入口仅用于商业版");
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
                for(String sql:args.getString("sql").split(";"))if(!sql.trim().isEmpty())database.execSQL(sql);return null;
            case "sqlBegin":database.beginTransaction();return null;
            case "sqlEnd":if(args.getBoolean("success"))database.setTransactionSuccessful();database.endTransaction();return null;
            case "sqlRun":return sqlRun(args);
            case "sqlQuery":return sqlQuery(args);
            case "musicList":return musicList();
            case "musicRemove":return removeMusic(args.getString("id"));
            case "knowledgeList":return knowledgeList();
            case "knowledgeSave":return knowledgeSave(args);
            case "knowledgeCreate":return knowledgeCreate(args.getString("title"),args.has("initialContent")&&!args.isNull("initialContent")?args.getString("initialContent"):null,args.has("expectedRoot")&&!args.isNull("expectedRoot")?args.getString("expectedRoot"):null);
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
            if(args.getString("sql").trim().toUpperCase(Locale.ROOT).startsWith("INSERT")){long id=st.executeInsert();return new JSONObject().put("changes",id<0?0:1).put("lastInsertRowid",Math.max(0,id));}
            int changed=st.executeUpdateDelete();return new JSONObject().put("changes",changed).put("lastInsertRowid",0);
        }
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
            if(resultCode!=RESULT_OK||data==null){reply(id,ok("musicImport".equals(method)?new JSONObject().put("added",0).put("skipped",0).put("tracks",musicList()):null));return;}
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
            JSONArray rows=new JSONArray(preferences.getString("music","[]")),next=new JSONArray();for(int i=0;i<rows.length();i++)if(!rows.getJSONObject(i).getString("id").equals(id))next.put(rows.get(i));if(!preferences.edit().putString("music",next.toString()).commit())throw new IOException("保存音乐列表失败");return next;
        }
        database.beginTransaction();try{database.delete("music_imports","id=?",new String[]{id});database.setTransactionSuccessful();}finally{database.endTransaction();}return musicList();
    }
    private synchronized JSONObject importMusic(List<Uri> uris)throws Exception{
        if(!resourceMigrationReady()){
            JSONArray list=new JSONArray(preferences.getString("music","[]"));int added=0,skipped=0;
            for(Uri uri:uris){try{File file=copyImport(uri,"music",MUSIC_EXTENSIONS,512L*1024*1024);String id=file.getName().split("\\.")[0];boolean duplicate=false;for(int i=0;i<list.length();i++)if(list.getJSONObject(i).getString("id").equals(id))duplicate=true;if(duplicate){skipped++;continue;}list.put(new JSONObject().put("id",id).put("file",ORIGIN+"/local/music/"+file.getName()).put("title",displayName(uri)).put("tag","local"));added++;}catch(Exception e){skipped++;}}
            if(!preferences.edit().putString("music",list.toString()).commit())throw new IOException("保存音乐列表失败");return new JSONObject().put("added",added).put("skipped",skipped).put("tracks",list);
        }
        int added=0,skipped=0;ArrayList<CopiedFile> pendingFiles=new ArrayList<>();ArrayList<JSONObject> pendingRows=new ArrayList<>();HashSet<String> pendingIds=new HashSet<>();
        for(Uri uri:uris){try{
            CopiedFile copied=copyImportTracked(uri,"music",MUSIC_EXTENSIONS,512L*1024*1024);String id=copied.file.getName().split("\\.")[0];boolean duplicate=false;try(Cursor c=database.rawQuery("SELECT 1 FROM music_imports WHERE id=?",new String[]{id})){duplicate=c.moveToFirst();}
            if(duplicate){skipped++;continue;}
            if(!pendingIds.add(id)){skipped++;continue;}
            pendingFiles.add(copied);pendingRows.add(new JSONObject().put("id",id).put("path",copied.file.getCanonicalPath()).put("title",displayName(uri)).put("createdAt",System.currentTimeMillis()));
        }catch(Exception e){skipped++;}}
        try{
            database.beginTransaction();
            for(JSONObject row:pendingRows){ContentValues values=new ContentValues();values.put("id",row.getString("id"));values.put("path",row.getString("path"));values.put("title",row.getString("title"));values.put("createdAt",row.getLong("createdAt"));long inserted=database.insertWithOnConflict("music_imports",null,values,SQLiteDatabase.CONFLICT_IGNORE);if(inserted<0)throw new IOException("保存音乐记录失败");if(inserted==0){skipped++;continue;}added++;}
            database.setTransactionSuccessful();
        }catch(Exception e){for(CopiedFile copied:pendingFiles)if(copied.created)copied.file.delete();throw e;
        }finally{if(database.inTransaction())database.endTransaction();}
        return new JSONObject().put("added",added).put("skipped",skipped).put("tracks",musicList());
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
        JSONArray notes=new JSONArray();skippedNotes=0;noteUris.clear();
        if(tree.isEmpty())scanLocal(knowledgeDir(),"",notes,0);else{Uri root=Uri.parse(tree);scanTree(root,DocumentsContract.getTreeDocumentId(root),"",notes,0);}
        List<JSONObject> sorted=new ArrayList<>();for(int i=0;i<notes.length();i++)sorted.add(notes.getJSONObject(i));sorted.sort((a,b)->Long.compare(b.optLong("modifiedAt"),a.optLong("modifiedAt")));
        return new JSONObject().put("root",tree.isEmpty()?"本机学习库":tree).put("notes",new JSONArray(sorted)).put("skipped",skippedNotes);
    }
    private JSONObject note(String path,byte[] bytes,long modified)throws Exception{return new JSONObject().put("path",path).put("title",path.substring(path.lastIndexOf('/')+1).replaceFirst("(?i)\\.md$","")).put("content",new String(bytes,StandardCharsets.UTF_8)).put("revision",hash(bytes)).put("modifiedAt",modified);}
    private void scanLocal(File dir,String prefix,JSONArray notes,int depth)throws Exception{
        if(depth>12){skippedNotes++;return;}File[] files=dir.listFiles();if(files==null)throw new IOException("无法读取学习库");
        for(File file:files){if(file.getName().startsWith("."))continue;String path=prefix+file.getName();if(file.isDirectory())scanLocal(file,path+"/",notes,depth+1);else if(path.toLowerCase(Locale.ROOT).endsWith(".md")){if(notes.length()>=2000||file.length()>2*1024*1024){skippedNotes++;continue;}notes.put(note(path,readBounded(new FileInputStream(file),2*1024*1024),file.lastModified()));}}
    }
    private void scanTree(Uri tree,String documentId,String prefix,JSONArray notes,int depth)throws Exception{
        if(depth>12){skippedNotes++;return;}
        String[] columns={DocumentsContract.Document.COLUMN_DOCUMENT_ID,DocumentsContract.Document.COLUMN_DISPLAY_NAME,DocumentsContract.Document.COLUMN_MIME_TYPE,DocumentsContract.Document.COLUMN_SIZE,DocumentsContract.Document.COLUMN_LAST_MODIFIED};
        Uri children=DocumentsContract.buildChildDocumentsUriUsingTree(tree,documentId);
        try(Cursor c=getContentResolver().query(children,columns,null,null,null)){if(c==null)throw new IOException("无法读取授权文件夹，请重新选择。");while(c.moveToNext()){
            String id=c.getString(0),name=c.getString(1),mime=c.getString(2),path=prefix+name;if(name.startsWith("."))continue;
            if(DocumentsContract.Document.MIME_TYPE_DIR.equals(mime))scanTree(tree,id,path+"/",notes,depth+1);
            else if(name.toLowerCase(Locale.ROOT).endsWith(".md")){if(notes.length()>=2000||c.getLong(3)>2*1024*1024){skippedNotes++;continue;}Uri uri=DocumentsContract.buildDocumentUriUsingTree(tree,id);try{byte[] bytes=readBounded(getContentResolver().openInputStream(uri),2*1024*1024);noteUris.put(path,uri);notes.put(note(path,bytes,c.getLong(4)));}catch(IOException e){skippedNotes++;}}
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
            String range=request.getRequestHeaders().get("Range");if(range==null)range=request.getRequestHeaders().get("range");long start=0,end=size-1;
            if(range!=null&&range.matches("bytes=\\d+-\\d*")){String[] pair=range.substring(6).split("-",-1);start=Long.parseLong(pair[0]);if(!pair[1].isEmpty())end=Math.min(end,Long.parseLong(pair[1]));if(start>=size||end<start){stream.close();headers.put("Content-Range","bytes */"+size);return new WebResourceResponse(mime,null,416,"Range Not Satisfiable",headers,new ByteArrayInputStream(new byte[0]));}long remain=start;while(remain>0){long skipped=stream.skip(remain);if(skipped<=0)throw new IOException("Cannot seek");remain-=skipped;}headers.put("Content-Range","bytes "+start+"-"+end+"/"+size);}
            long length=Math.max(0,end-start+1);headers.put("Content-Length",Long.toString(length));InputStream bounded=new LimitedStream(stream,length);
            return new WebResourceResponse(mime,Arrays.asList("html","css","js","json","svg").contains(ext)?"UTF-8":null,range==null?200:206,range==null?"OK":"Partial Content",headers,bounded);
        }catch(Exception e){return new WebResourceResponse("text/plain","UTF-8",404,"Not Found",new HashMap<>(),new ByteArrayInputStream(new byte[0]));}
    }
    private static class LimitedStream extends FilterInputStream{long remaining;LimitedStream(InputStream in,long length){super(in);remaining=length;}@Override public int read()throws IOException{if(remaining<=0)return -1;int v=super.read();if(v!=-1)remaining--;return v;}@Override public int read(byte[] b,int offset,int length)throws IOException{if(remaining<=0)return -1;int n=in.read(b,offset,(int)Math.min(remaining,length));if(n>0)remaining-=n;return n;}}
    private static String mime(String ext){switch(ext){case "html":return "text/html";case "js":return "application/javascript";case "css":return "text/css";case "json":return "application/json";case "svg":return "image/svg+xml";case "png":return "image/png";case "jpg":case "jpeg":return "image/jpeg";case "webp":return "image/webp";case "mp4":return "video/mp4";case "webm":return "video/webm";case "ogg":return "audio/ogg";case "mp3":return "audio/mpeg";case "wav":return "audio/wav";case "m4a":return "audio/mp4";case "ttf":return "font/ttf";case "woff2":return "font/woff2";default:return "application/octet-stream";}}
}
