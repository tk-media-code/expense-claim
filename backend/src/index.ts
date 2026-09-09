import { serve } from '@hono/node-server';
import { Hono } from 'hono';

const app = new Hono();
const port = Number(process.env.PORT) || 3000;

serve(
	{
		fetch: app.fetch,
		port,
		hostname: '0.0.0.0',
	},
	(info) => {
		console.log(`listening on ${info.address}:${info.port}`);
	},
);
