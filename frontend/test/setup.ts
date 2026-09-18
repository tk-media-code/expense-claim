import { registerEndpoint } from '@nuxt/test-utils/runtime';

// 全画面に route middleware（middleware/auth.global.ts）が掛かり、開いた最初に GET /api/auth/session を
// 叩く。画面のテストはログイン済みとして書くので、ここで一括して通す。
// 未ログインの挙動は middleware 単体のテストが useApi を差し替えて見る
registerEndpoint('/api/auth/session', () => ({ authenticated: true }));
