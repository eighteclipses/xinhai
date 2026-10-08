package com.xinhai.study;

import org.json.JSONObject;
import java.io.*;
import java.net.*;
import java.nio.charset.StandardCharsets;
import java.util.*;
import java.util.concurrent.*;

/** Restricted, application-encrypted LAN transport. No WebView cleartext exception. */
final class LanSyncHttp {
    private static final int PORT=7392, LIMIT=8*1024*1024, HEADER_LIMIT=8192, TIMEOUT=5000;
    private static final String PAIR="/xinhai-sync/v1/pair", EXCHANGE="/xinhai-sync/v1/exchange";
    private static final ScheduledExecutorService deadlines=Executors.newSingleThreadScheduledExecutor(r->{Thread t=new Thread(r,"xinhai-sync-deadline");t.setDaemon(true);return t;});

    private LanSyncHttp(){}
    static JSONObject request(JSONObject args)throws IOException {
        try {
            String host=args.getString("host"), path=args.getString("path");
            if(args.getInt("port")!=PORT||(!PAIR.equals(path)&&!EXCHANGE.equals(path)))throw new IOException();
            byte[] address=privateAddress(host);
            String body=args.getString("body");
            if(body.length()>LIMIT)throw new IOException();
            byte[] data=body.getBytes(StandardCharsets.UTF_8);
            if(data.length>LIMIT)throw new IOException();
            // Only authenticated envelope fields are permitted across this bridge.
            // Plaintext sync packets and arbitrary HTTP bodies are not supported.
            JSONObject envelope=new JSONObject(body);
            Set<String> keys=new HashSet<>(Arrays.asList("hostId","peerId","requestId","iv","body"));
            if(envelope.length()!=keys.size())throw new IOException();
            for(Iterator<String> it=envelope.keys();it.hasNext();)if(!keys.contains(it.next()))throw new IOException();
            for(String id:Arrays.asList("hostId","peerId","requestId"))if(!envelope.getString(id).matches("(?i)[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}"))throw new IOException();
            if(!envelope.getString("iv").matches("[A-Za-z0-9_-]{16}"))throw new IOException();
            String cipher=envelope.getString("body");
            if(cipher.length()<22||cipher.length()>LIMIT||cipher.length()%4==1||!cipher.matches("[A-Za-z0-9_-]+"))throw new IOException();
            try(Socket socket=new Socket()) {
                // Socket read timeouts alone do not bound a slow-drip response or a
                // blocked write. Closing the socket enforces a total 15s deadline.
                ScheduledFuture<?> deadline=deadlines.schedule(()->{try{socket.close();}catch(IOException ignored){}},15,TimeUnit.SECONDS);
                try {
                    socket.connect(new InetSocketAddress(InetAddress.getByAddress(address),PORT),TIMEOUT);
                    socket.setSoTimeout(TIMEOUT);
                    String headers="POST "+path+" HTTP/1.1\r\nHost: "+host+":"+PORT+"\r\nContent-Type: application/json\r\nContent-Length: "+data.length+"\r\nConnection: close\r\n\r\n";
                    OutputStream out=socket.getOutputStream();
                    out.write(headers.getBytes(StandardCharsets.US_ASCII));out.write(data);out.flush();
                    InputStream in=new BufferedInputStream(socket.getInputStream());
                    int[] remaining={HEADER_LIMIT};
                    String first=line(in,remaining);
                    if(!first.matches("HTTP/1\\.[01] [1-5][0-9]{2}(?: [\\x20-\\x7e]*)?"))throw new IOException();
                    int status=Integer.parseInt(first.substring(9,12));
                    // No informational responses or redirects; never follow Location.
                    if(status<200||(status>=300&&status<400))throw new IOException();
                    Map<String,String> responseHeaders=new HashMap<>();
                    for(;;){
                        String header=line(in,remaining);if(header.isEmpty())break;
                        int colon=header.indexOf(':');if(colon<=0)throw new IOException();
                        String key=header.substring(0,colon).toLowerCase(Locale.ROOT);
                        String value=header.substring(colon+1).trim();
                        if(!key.matches("[a-z0-9-]+")||responseHeaders.put(key,value)!=null)throw new IOException();
                    }
                    if(responseHeaders.containsKey("transfer-encoding")||responseHeaders.containsKey("content-encoding")||!"close".equalsIgnoreCase(responseHeaders.get("connection")))throw new IOException();
                    String length=responseHeaders.get("content-length");
                    if(length==null||!length.matches("[0-9]{1,8}"))throw new IOException();
                    int count=Integer.parseInt(length);if(count>LIMIT)throw new IOException();
                    byte[] result=new byte[count];int offset=0;
                    while(offset<count){int n=in.read(result,offset,count-offset);if(n<0)throw new EOFException();offset+=n;}
                    return new JSONObject().put("status",status).put("body",new String(result,StandardCharsets.UTF_8));
                } finally { deadline.cancel(false); }
            }
        } catch(Exception ignored) {
            // Never propagate a request body, key, address or socket exception.
            throw new IOException("局域网同步连接失败，请检查网络后重试。");
        }
    }
    private static byte[] privateAddress(String host)throws IOException {
        if(!host.matches("(?:0|[1-9][0-9]{0,2})(?:\\.(?:0|[1-9][0-9]{0,2})){3}"))throw new IOException();
        String[] parts=host.split("\\.");int[] p=new int[4];byte[] result=new byte[4];
        for(int i=0;i<4;i++){p[i]=Integer.parseInt(parts[i]);if(p[i]>255)throw new IOException();result[i]=(byte)p[i];}
        if(!(p[0]==10||(p[0]==172&&p[1]>=16&&p[1]<=31)||(p[0]==192&&p[1]==168)))throw new IOException();
        return result;
    }
    private static String line(InputStream in,int[] remaining)throws IOException {
        ByteArrayOutputStream out=new ByteArrayOutputStream();
        for(;;){
            if(--remaining[0]<0)throw new IOException();int b=in.read();if(b<0)throw new EOFException();
            if(b=='\r'){if(--remaining[0]<0||in.read()!='\n')throw new IOException();return out.toString(StandardCharsets.US_ASCII.name());}
            if(b<32||b>126)throw new IOException();out.write(b);
        }
    }
}
