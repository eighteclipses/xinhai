package com.xinhai.study;

import android.Manifest;
import android.app.Activity;
import android.app.AlarmManager;
import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.media.AudioAttributes;
import android.media.RingtoneManager;
import android.net.Uri;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;
import android.provider.Settings;
import android.util.Log;
import org.json.JSONObject;
import java.io.IOException;

/** One user-requested focus deadline, independent of the WebView's timers. */
public final class FocusReminder extends BroadcastReceiver {
    private static final String STORE="xinhai-focus-reminder", CHANNEL="focus-complete-v1";
    private static final String ACTION="com.xinhai.study.FOCUS_DEADLINE";
    private static final int REQUEST=23071, NOTIFICATION=23072, PERMISSION_REQUEST=23073, FIRED_HISTORY=64;
    private static final Handler HANDLER=new Handler(Looper.getMainLooper());
    private static Runnable pendingRunnable;
    private static String armedToken;
    private static long armedDeadline;
    private static boolean armedExact;

    private static SharedPreferences state(Context context){return context.getSharedPreferences(STORE,Context.MODE_PRIVATE);}
    private static AlarmManager alarms(Context context)throws IOException{
        AlarmManager result=context.getSystemService(AlarmManager.class);
        if(result==null)throw new IOException("此设备未提供系统计时提醒服务");
        return result;
    }
    private static boolean fired(SharedPreferences prefs,String token){
        for(int i=0;i<FIRED_HISTORY;i++)if(token.equals(prefs.getString("fired-"+i,"")))return true;
        return false;
    }
    private static PendingIntent alarmIntent(Context context,String token,long deadline,int flags){
        Intent intent=new Intent(context,FocusReminder.class).setAction(ACTION)
            .setData(Uri.parse("xinhai-focus://deadline/"+Uri.encode(token)))
            .putExtra("token",token).putExtra("deadline",deadline);
        return PendingIntent.getBroadcast(context,REQUEST,intent,flags|PendingIntent.FLAG_IMMUTABLE);
    }
    private static void cancelRuntime(Context context,String token){
        if(pendingRunnable!=null){HANDLER.removeCallbacks(pendingRunnable);pendingRunnable=null;}
        armedToken=null;armedDeadline=0;
        if(token.isEmpty())return;
        PendingIntent pending=alarmIntent(context,token,0,PendingIntent.FLAG_NO_CREATE);
        if(pending!=null){try{alarms(context).cancel(pending);}catch(Exception e){Log.w("XinhaiFocus","取消系统提醒失败",e);}pending.cancel();}
    }
    private static void clearPending(Context context)throws IOException{
        SharedPreferences prefs=state(context);
        cancelRuntime(context,prefs.getString("token",""));
        // Preserve fired tokens and an already posted notification. Renderer
        // cleanup after reaching zero must not cancel a just-delivered sound.
        if(!prefs.edit().remove("token").remove("deadline").remove("title").commit())throw new IOException("取消专注提醒未保存，请重试");
    }
    private static void channel(Context context){
        NotificationManager manager=context.getSystemService(NotificationManager.class);
        if(manager==null)return;
        NotificationChannel channel=new NotificationChannel(CHANNEL,"专注到时提醒",NotificationManager.IMPORTANCE_HIGH);
        channel.setDescription("专注倒计时结束时提醒；声音与免打扰遵循系统设置");
        channel.setSound(RingtoneManager.getDefaultUri(RingtoneManager.TYPE_NOTIFICATION),new AudioAttributes.Builder()
            .setUsage(AudioAttributes.USAGE_NOTIFICATION).setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION).build());
        manager.createNotificationChannel(channel);
    }
    private static boolean armAlarm(Context context,String token,long deadline)throws IOException{
        AlarmManager manager=alarms(context);
        PendingIntent intent=alarmIntent(context,token,deadline,PendingIntent.FLAG_UPDATE_CURRENT);
        if(Build.VERSION.SDK_INT<31||manager.canScheduleExactAlarms()){
            try{
                // An explicitly started focus countdown is a user-visible timer.
                // Alarm-clock scheduling exposes its next deadline to the user
                // and avoids the batching/adjustment of ordinary idle alarms.
                // Delivery still uses the user's notification/DND preferences;
                // this does not start an activity or a second audio stream.
                Intent open=new Intent(context,MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP|Intent.FLAG_ACTIVITY_SINGLE_TOP);
                PendingIntent show=PendingIntent.getActivity(context,REQUEST,open,PendingIntent.FLAG_UPDATE_CURRENT|PendingIntent.FLAG_IMMUTABLE);
                manager.setAlarmClock(new AlarmManager.AlarmClockInfo(deadline,show),intent);
                return true;
            }
            catch(SecurityException denied){Log.i("XinhaiFocus","精确提醒不可用，使用系统允许的普通提醒");}
        }
        // No settings screen or special permission is forced. In Doze this
        // fallback can be delayed by Android or manufacturer policy.
        manager.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP,deadline,intent);
        return false;
    }
    private static void arm(Context context,String token,long deadline)throws IOException{
        boolean exact=Build.VERSION.SDK_INT<31||alarms(context).canScheduleExactAlarms();
        if(token.equals(armedToken)&&deadline==armedDeadline&&pendingRunnable!=null&&armedExact==exact)return;
        if(pendingRunnable!=null)HANDLER.removeCallbacks(pendingRunnable);
        armedExact=armAlarm(context,token,deadline);
        armedToken=token;armedDeadline=deadline;
        Context app=context.getApplicationContext();
        pendingRunnable=()->{
            synchronized(FocusReminder.class){
                if(!token.equals(armedToken)||deadline!=armedDeadline)return;
                pendingRunnable=null;
                try{deliver(app,token,deadline);}catch(Exception e){Log.e("XinhaiFocus","投递专注提醒失败",e);}
            }
        };
        // Foreground delivery does not rely on WebView timers or obtaining the
        // optional exact-alarm capability. AlarmManager covers idle delivery.
        HANDLER.postDelayed(pendingRunnable,Math.max(0,deadline-System.currentTimeMillis()));
    }
    public static synchronized void update(Activity activity,JSONObject args)throws Exception{
        Context context=activity.getApplicationContext();
        Object value=args.opt("reminder");
        if(value==null||value==JSONObject.NULL){clearPending(context);return;}
        if(!(value instanceof JSONObject))throw new IOException("专注提醒参数无效");
        JSONObject input=(JSONObject)value;
        Object rawToken=input.opt("token"),rawDeadline=input.opt("deadline"),rawTitle=input.opt("title");
        if(!(rawToken instanceof String)||((String)rawToken).isEmpty()||((String)rawToken).length()>160||
            !(rawDeadline instanceof Number)||!Double.isFinite(((Number)rawDeadline).doubleValue())||
            ((Number)rawDeadline).doubleValue()>System.currentTimeMillis()+7d*86400000||
            !(rawTitle instanceof String)||((String)rawTitle).length()>100)throw new IOException("专注提醒参数无效");
        String token=(String)rawToken,title=(String)rawTitle;
        long deadline=((Number)rawDeadline).longValue();
        SharedPreferences prefs=state(context);
        if(fired(prefs,token))return;
        String previous=prefs.getString("token","");
        boolean same=token.equals(previous)&&deadline==prefs.getLong("deadline",0);
        if(!same){
            cancelRuntime(context,previous);
            if(!prefs.edit().putString("token",token).putLong("deadline",deadline).putString("title",title).commit())throw new IOException("专注提醒未保存，请重试");
        }
        channel(context);
        if(deadline<=System.currentTimeMillis())deliver(context,token,deadline);else arm(context,token,deadline);
        activity.runOnUiThread(()->requestNotificationPermission(activity));
    }
    private static void requestNotificationPermission(Activity activity){
        if(Build.VERSION.SDK_INT<33||activity.isFinishing()||activity.isDestroyed()||
            activity.checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS)==PackageManager.PERMISSION_GRANTED)return;
        SharedPreferences prefs=state(activity);
        if(prefs.getBoolean("notification-permission-requested",false))return;
        // Ask once in response to a focus timer, not automatically at app boot.
        prefs.edit().putBoolean("notification-permission-requested",true).apply();
        activity.requestPermissions(new String[]{Manifest.permission.POST_NOTIFICATIONS},PERMISSION_REQUEST);
    }
    public static JSONObject status(Context context)throws Exception{
        NotificationManager manager=context.getSystemService(NotificationManager.class);
        boolean notifications=manager!=null&&manager.areNotificationsEnabled()&&
            (Build.VERSION.SDK_INT<33||context.checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS)==PackageManager.PERMISSION_GRANTED);
        if(manager!=null){NotificationChannel existing=manager.getNotificationChannel(CHANNEL);if(existing!=null&&existing.getImportance()==NotificationManager.IMPORTANCE_NONE)notifications=false;}
        return new JSONObject().put("platform","android").put("notificationsGranted",notifications)
            .put("exactAlarmsGranted",Build.VERSION.SDK_INT<31||alarms(context).canScheduleExactAlarms())
            .put("canRequestExactAlarms",Build.VERSION.SDK_INT>=31);
    }
    public static void requestAccess(Activity activity,String access)throws IOException{
        if(!"notifications".equals(access)&&!"exact-alarm".equals(access)&&!"background".equals(access))throw new IOException("提醒设置入口无效");
        if("exact-alarm".equals(access)&&Build.VERSION.SDK_INT<31)throw new IOException("此系统不需要额外的精确提醒权限");
        // Open only this application's capability page, in response to a button.
        // No automatic settings launch and no silent permission changes.
        activity.runOnUiThread(()->{
            Intent intent;
            if("exact-alarm".equals(access))intent=new Intent(Settings.ACTION_REQUEST_SCHEDULE_EXACT_ALARM).setData(Uri.parse("package:"+activity.getPackageName()));
            else if("notifications".equals(access))intent=new Intent(Settings.ACTION_APP_NOTIFICATION_SETTINGS).putExtra(Settings.EXTRA_APP_PACKAGE,activity.getPackageName());
            else intent=new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS).setData(Uri.parse("package:"+activity.getPackageName()));
            try{activity.startActivity(intent);}catch(Exception unavailable){
                try{activity.startActivity(new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS).setData(Uri.parse("package:"+activity.getPackageName())));}catch(Exception failure){Log.w("XinhaiFocus","无法打开本应用提醒设置",failure);}
            }
        });
    }
    public static synchronized void resume(Context original){
        Context context=original.getApplicationContext();
        SharedPreferences prefs=state(context);
        String token=prefs.getString("token","");long deadline=prefs.getLong("deadline",0);
        if(token.isEmpty())return;
        try{
            channel(context);
            if(fired(prefs,token)){clearPending(context);return;}
            if(deadline<=System.currentTimeMillis())deliver(context,token,deadline);else arm(context,token,deadline);
        }catch(Exception e){Log.e("XinhaiFocus","恢复专注提醒失败",e);}
    }
    private static synchronized void deliver(Context context,String token,long deadline)throws Exception{
        SharedPreferences prefs=state(context);
        if(token==null||!token.equals(prefs.getString("token",""))||deadline!=prefs.getLong("deadline",0)||fired(prefs,token))return;
        if(System.currentTimeMillis()<deadline){
            // Wall-clock changes or old queued broadcasts cannot ring early.
            armedToken=null;arm(context,token,deadline);return;
        }
        String title=prefs.getString("title","");
        int index=prefs.getInt("fired-index",0)%FIRED_HISTORY;
        if(!prefs.edit().putString("fired-"+index,token).putInt("fired-index",(index+1)%FIRED_HISTORY)
            .remove("token").remove("deadline").remove("title").commit())throw new IOException("专注提醒状态未保存");
        cancelRuntime(context,token);
        NotificationManager manager=context.getSystemService(NotificationManager.class);
        // Permission, channel muting, volume and DND remain authoritative.
        // Never play another audio stream around those user choices.
        if(manager==null||!manager.areNotificationsEnabled()||
            (Build.VERSION.SDK_INT>=33&&context.checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS)!=PackageManager.PERMISSION_GRANTED))return;
        channel(context);
        Intent open=new Intent(context,MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP|Intent.FLAG_ACTIVITY_SINGLE_TOP);
        PendingIntent content=PendingIntent.getActivity(context,REQUEST,open,PendingIntent.FLAG_UPDATE_CURRENT|PendingIntent.FLAG_IMMUTABLE);
        Notification notification=new Notification.Builder(context,CHANNEL)
            .setSmallIcon(android.R.drawable.ic_lock_idle_alarm).setContentTitle(title.isEmpty()?"计时已结束":title)
            .setContentText("打开心海查看本轮记录。")
            .setCategory(Notification.CATEGORY_REMINDER).setVisibility(Notification.VISIBILITY_PRIVATE)
            .setContentIntent(content).setAutoCancel(true).setTimeoutAfter(86400000).build();
        manager.cancel(NOTIFICATION);
        manager.notify(NOTIFICATION,notification);
    }
    @Override public void onReceive(Context context,Intent intent){
        if(intent!=null&&Build.VERSION.SDK_INT>=31&&AlarmManager.ACTION_SCHEDULE_EXACT_ALARM_PERMISSION_STATE_CHANGED.equals(intent.getAction())){
            resume(context);return;
        }
        if(intent==null||!ACTION.equals(intent.getAction()))return;
        try{deliver(context,intent.getStringExtra("token"),intent.getLongExtra("deadline",0));}
        catch(Exception e){Log.e("XinhaiFocus","系统专注提醒未完成",e);}
    }
}
