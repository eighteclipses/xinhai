import { database, identity, failure } from '@/lib/server';
import type { Kind } from '@/lib/domain';

type RecordRow = {
  id: string;
  kind: Kind;
  payload: string;
  version: number;
  updated: number;
};

export async function GET() {
  try {
    const owner = await identity();
    const result = await database()
      .prepare(
        'SELECT id, kind, payload, version, updated FROM records WHERE owner = ? ORDER BY updated DESC',
      )
      .bind(owner)
      .all<RecordRow>();
    return Response.json(
      {
        items: result.results.map((r) => ({
          id: r.id,
          kind: r.kind,
          data: JSON.parse(r.payload) as unknown,
          version: r.version,
          updated: r.updated,
        })),
      },
      { headers: { 'Cache-Control': 'no-store' } },
    );
  } catch (e) {
    return failure(e);
  }
}
