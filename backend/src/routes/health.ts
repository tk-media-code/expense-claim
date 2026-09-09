import { Hono } from 'hono';

// 04-api.md には無い、運用のためのエンドポイント。
// compose の healthcheck と、nginx → backend の配線を機械で確かめるために置く。
// 業務データを返さないので 04-api.md 2.7「持たないもの」には触れない。
export const healthRoute = new Hono().get('/', (c) => c.json({ status: 'ok' }));
