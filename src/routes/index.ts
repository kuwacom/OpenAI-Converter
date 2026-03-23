import { Hono } from 'hono';
import v1Router from '@/routes/v1';

const router = new Hono();

router.route('/v1', v1Router);

export default router;
