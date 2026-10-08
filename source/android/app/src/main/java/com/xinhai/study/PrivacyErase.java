package com.xinhai.study;

import android.app.Activity;
import android.app.ActivityManager;
import org.json.JSONObject;
import java.io.IOException;
import java.util.UUID;

/** Only Android's own app-data erasure API may delete the commercial profile. */
final class PrivacyErase {
    private final Activity activity;
    private String ticket;
    private long expiresAt;
    private String knowledgeAtPreview;
    PrivacyErase(Activity activity) { this.activity = activity; }
    synchronized JSONObject prepare(String externalKnowledge) throws Exception {
        requireCommercial();
        ticket = UUID.randomUUID().toString();
        expiresAt = System.currentTimeMillis() + 600000;
        knowledgeAtPreview=externalKnowledge;
        return new JSONObject().put("ticket", ticket).put("expiresAt", expiresAt)
            .put("platform", "android").put("location", activity.getApplicationInfo().dataDir)
            .put("preservedKnowledge", externalKnowledge.isEmpty() ? JSONObject.NULL : externalKnowledge);
    }
    synchronized void cancel() { ticket = null; }
    synchronized void erase(JSONObject args,String currentKnowledge) throws Exception {
        requireCommercial();
        if (!"清空本应用资料".equals(args.optString("confirmation"))) throw new IOException("请输入“清空本应用资料”确认");
        if (ticket == null || !ticket.equals(args.optString("ticket")) || System.currentTimeMillis() > expiresAt) throw new IOException("清理预览已失效，请重新查看范围");
        if(!currentKnowledge.equals(knowledgeAtPreview))throw new IOException("知识库位置已变化，请重新查看清理范围");
        ActivityManager manager = (ActivityManager) activity.getSystemService(Activity.ACTIVITY_SERVICE);
        if (manager == null || !manager.clearApplicationUserData()) throw new IOException("系统未接受清理，请稍后重试或在系统应用设置中清除本应用存储");
        ticket = null;
        // Accepted does not mean completed; Android terminates this app to finish.
    }
    private static void requireCommercial() throws IOException {
        if (!BuildConfig.COMMERCIAL_EDITION) throw new IOException("此操作仅用于独立商业版");
    }
}
