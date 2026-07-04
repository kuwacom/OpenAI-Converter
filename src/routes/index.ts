import { Hono } from 'hono';
import { fallback } from '@/routes/fallback';
import v1Router from '@/routes/v1';
import type { AppEnv } from '@/types/env';

const router = new Hono<AppEnv>();

router.route('/v1', v1Router);
// /v1 以外へのアクセスを拒否する
router.all('*', fallback);

export default router;
