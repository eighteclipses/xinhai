package com.xinhai.study;

import android.app.*;
import android.content.*;
import android.net.Uri;
import android.webkit.*;
import android.webkit.CookieManager;
import android.widget.*;
import org.json.*;
import java.io.*;
import java.net.*;
import java.nio.charset.StandardCharsets;

/** Official login stays in an unprivileged WebView; cookies never enter the app renderer. */
final class NetEaseService {
    private static final String ORIGIN="https://music.163.com";
    private final Activity activity;
    private Dialog dialog;
    NetEaseService(Activity activity){this.activity=activity;}
    String shareRedirect(String value)throws Exception{
        URL url=new URL(value);if(!"https".equals(url.getProtocol())||url.getUserInfo()!=null||url.getPort()!=-1||!java.util.Arrays.asList("163cn.tv","163cn.com").contains(url.getHost()))throw new IOException("分享链接无效");
        HttpURLConnection c=(HttpURLConnection)url.openConnection();
        try{c.setConnectTimeout(12000);c.setReadTimeout(12000);c.setInstanceFollowRedirects(false);int status=c.getResponseCode();String location=c.getHeaderField("Location");if(!java.util.Arrays.asList(301,302,303,307,308).contains(status)||location==null)throw new IOException("短链接未能解析，请复制完整歌单链接。");return new URL(url,location).toString();}finally{c.disconnect();}
    }
    void login(){
        if(dialog!=null&&dialog.isShowing())return;
        dialog=new Dialog(activity,android.R.style.Theme_Material_NoActionBar);
        LinearLayout layout=new LinearLayout(activity);layout.setOrientation(LinearLayout.VERTICAL);
        if(android.os.Build.VERSION.SDK_INT>=30){
            dialog.getWindow().setDecorFitsSystemWindows(false);
            layout.setOnApplyWindowInsetsListener((v,insets)->{android.graphics.Insets bars=insets.getInsets(android.view.WindowInsets.Type.systemBars()|android.view.WindowInsets.Type.displayCutout()|android.view.WindowInsets.Type.ime());v.setPadding(bars.left,bars.top,bars.right,bars.bottom);return insets;});
        }
        Button done=new Button(activity);done.setText("登录完成后点此返回，再点击“读取我的歌单”");layout.addView(done);
        WebView view=new WebView(activity);WebSettings settings=view.getSettings();
        settings.setJavaScriptEnabled(true);settings.setDomStorageEnabled(true);settings.setAllowFileAccess(false);settings.setAllowContentAccess(false);
        settings.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        settings.setUserAgentString("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36");
        CookieManager.getInstance().setAcceptCookie(true);
        view.setWebViewClient(new WebViewClient(){@Override public boolean shouldOverrideUrlLoading(WebView v,WebResourceRequest request){Uri u=request.getUrl();String host=u.getHost();return !"https".equals(u.getScheme())||host==null||!(host.equals("163.com")||host.endsWith(".163.com"));}});
        view.setWebChromeClient(new WebChromeClient(){@Override public void onPermissionRequest(PermissionRequest r){r.deny();}});
        layout.addView(view,new LinearLayout.LayoutParams(-1,0,1));dialog.setContentView(layout);
        done.setOnClickListener(v->dialog.dismiss());dialog.setOnDismissListener(d->{CookieManager.getInstance().flush();view.destroy();dialog=null;});
        dialog.show();dialog.getWindow().setLayout(-1,-1);view.loadUrl(ORIGIN+"/#/my/");
    }
    JSONObject request(String path)throws Exception{
        if(!path.matches("/api/(nuser/account/get|user/playlist|(?:v6/)?playlist/detail|song/detail/?|song/enhance/player/url|login/qrcode/unikey|login/qrcode/client/login)(\\?[^#\\r\\n]*)?"))throw new IOException("不支持的网易云请求");
        HttpsURLConnectionWrapper response=new HttpsURLConnectionWrapper(ORIGIN+path);
        return response.read();
    }
    private static class HttpsURLConnectionWrapper {
        private final String url;
        HttpsURLConnectionWrapper(String url){this.url=url;}
        JSONObject read()throws Exception{
            boolean poll=url.startsWith(ORIGIN+"/api/login/qrcode/client/login?");
            HttpURLConnection c=(HttpURLConnection)new URL(poll?url.split("\\?",2)[0]:url).openConnection();
            try{
                c.setConnectTimeout(15000);c.setReadTimeout(20000);c.setInstanceFollowRedirects(false);c.setRequestProperty("Referer",ORIGIN+"/");c.setRequestProperty("User-Agent","Mozilla/5.0");
                String cookies=CookieManager.getInstance().getCookie(ORIGIN);if(cookies!=null)c.setRequestProperty("Cookie",cookies);
                if(poll){c.setRequestMethod("POST");c.setDoOutput(true);c.setRequestProperty("Content-Type","application/x-www-form-urlencoded");try(OutputStream out=c.getOutputStream()){out.write(url.split("\\?",2)[1].getBytes(StandardCharsets.UTF_8));}}
                if(c.getResponseCode()!=200)throw new IOException("网易云连接失败，请稍后重试。");
                for(java.util.Map.Entry<String,java.util.List<String>> h:c.getHeaderFields().entrySet())if("Set-Cookie".equalsIgnoreCase(h.getKey()))for(String cookie:h.getValue())CookieManager.getInstance().setCookie(ORIGIN,cookie);
                CookieManager.getInstance().flush();
                try(InputStream in=c.getInputStream();ByteArrayOutputStream out=new ByteArrayOutputStream()){
                    byte[] buffer=new byte[8192];int n;while((n=in.read(buffer))!=-1){if(out.size()+n>12*1024*1024)throw new IOException("网易云响应过大");out.write(buffer,0,n);}
                    return new JSONObject(out.toString("UTF-8"));
                }
            }finally{c.disconnect();}
        }
    }
    void logout(){
        if(dialog!=null)dialog.dismiss();
        CookieManager manager=CookieManager.getInstance();
        String cookies=manager.getCookie(ORIGIN);
        if(cookies!=null)for(String item:cookies.split(";")){String name=item.trim().split("=",2)[0];for(String domain:new String[]{"music.163.com",".music.163.com",".163.com"})manager.setCookie(ORIGIN,name+"=; Max-Age=0; Expires=Thu, 01 Jan 1970 00:00:00 GMT; Path=/; Domain="+domain+"; Secure; HttpOnly");}
        manager.flush();
    }
    /** Local-only retirement of the commercial build's former music login. */
    void clearLegacyData(java.util.function.Consumer<Exception> done){
        if(!BuildConfig.COMMERCIAL_EDITION){done.accept(new IOException("此清理入口仅用于主题版"));return;}
        try{
            if(dialog!=null)dialog.dismiss();
            // This app's cookie jar was used only by the music login.
            // Model credentials are in Keystore, never in CookieManager.
            CookieManager manager=CookieManager.getInstance();
            manager.removeAllCookies(removed->{
                try{
                    manager.flush();
                    WebStorage storage=WebStorage.getInstance();
                    storage.getOrigins(origins->{
                        try{
                            for(Object key:origins.keySet()){
                                String origin=String.valueOf(key),host=Uri.parse(origin).getHost();
                                if(host!=null&&(host.equals("163.com")||host.endsWith(".163.com")))storage.deleteOrigin(origin);
                            }
                            // HTTP cache only; preserve the app origin's DOM storage.
                            WebView cache=new WebView(activity);cache.clearCache(true);cache.destroy();
                            done.accept(null);
                        }catch(Exception e){done.accept(e);}
                    });
                }catch(Exception e){done.accept(e);}
            });
        }catch(Exception e){done.accept(e);}
    }
    void open(String id)throws Exception{if(!id.matches("[1-9][0-9]{0,18}"))throw new IOException("歌曲编号无效");activity.startActivity(new Intent(Intent.ACTION_VIEW,Uri.parse(ORIGIN+"/#/song?id="+id)));}
}
