// Sends Паричник's evening notification to the phone saved in the PARICNIK_PUSH secret.
// The phone writes the text itself from its own data; this only says "time to show it".
import webpush from 'web-push';

const raw = (process.env.PARICNIK_PUSH || '').trim();
if (!raw) {
  console.log('PARICNIK_PUSH secret is not set yet: turn on notifications in the app and add the code to GitHub.');
  process.exit(0);
}

let cfg;
try {
  cfg = JSON.parse(Buffer.from(raw, 'base64').toString('utf8'));
} catch {
  console.error('PARICNIK_PUSH is not a valid code. Copy it again from the app (Settings → Notifications).');
  process.exit(1);
}

const tz = cfg.tz || 'America/New_York';
const isManual = process.env.EVENT_NAME === 'workflow_dispatch';

if (!isManual) {
  // Two schedules run every night (01:00 and 02:00 UTC). Only the one that is 21:00 on the phone's clock sends,
  // so daylight saving time is handled without changing anything.
  const utcHour = parseInt((process.env.SCHEDULE || '').split(' ')[1], 10);
  const now = new Date();
  const slot = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), utcHour));
  const localHour = Number(new Intl.DateTimeFormat('en-US', { timeZone: tz, hour: 'numeric', hourCycle: 'h23' }).format(slot));
  if (localHour !== 21) {
    console.log(`Schedule ${utcHour}:00 UTC is ${localHour}:00 in ${tz}; the other schedule sends tonight.`);
    process.exit(0);
  }
}

webpush.setVapidDetails(cfg.subject || 'https://darionmitoski20-del.github.io/paricnik/', cfg.pub, cfg.priv);

try {
  const res = await webpush.sendNotification(cfg.sub, JSON.stringify({ kind: isManual ? 'test' : 'daily' }), {
    TTL: 3 * 60 * 60,
    urgency: 'normal',
  });
  console.log(`Sent (${res.statusCode}).`);
} catch (err) {
  if (err.statusCode === 404 || err.statusCode === 410) {
    console.error('This phone is no longer subscribed. In the app, turn notifications off and on again, then update the PARICNIK_PUSH secret.');
  } else {
    console.error(`Sending failed: ${err.statusCode || ''} ${err.body || err.message}`);
  }
  process.exit(1);
}
