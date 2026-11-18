import { env } from 'cloudflare:workers';
import { getChatGPTUser } from '@/app/chatgpt-auth';
export function database() {
  if (!env.DB) throw new Error('数据服务暂不可用');
  return env.DB;
}
export function files() {
  return (env as unknown as { FILES: R2Bucket }).FILES;
}
export async function identity() {
  const user = await getChatGPTUser();
  if (!user) throw new ApiError(401, '请先登录后保存记录');
  return user.userId;
}
export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}
export function failure(error: unknown) {
  if (error instanceof ApiError)
    return Response.json({ error: error.message }, { status: error.status });
  if (error instanceof SyntaxError || error instanceof TypeError)
    return Response.json({ error: '请求格式不正确' }, { status: 400 });
  console.error(error);
  return Response.json(
    { error: '操作未完成，请稍后重试；你的输入仍在页面中。' },
    { status: 500 },
  );
}
export function safeWrite(request: Request) {
  const origin = request.headers.get('origin');
  if (origin && origin !== new URL(request.url).origin)
    throw new ApiError(403, '请求来源不匹配');
}
