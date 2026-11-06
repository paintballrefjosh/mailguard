require('dotenv').config();
const express    = require('express');
const http       = require('http');
const cors       = require('cors');
const helmet     = require('helmet');
const morgan     = require('morgan');
const rateLimit  = require('express-rate-limit');
const { scheduleJobs } = require('./services/scheduler');
const { initWss }      = require('./services/websocket');
const { initGeoIp }    = require('./services/geoip');
const { regenerateRules } = require('./utils/postfix-rules');
const { regenerateCompoundRules } = require('./utils/compound-rules');

const app    = express();
const server = http.createServer(app);

app.set('trust proxy', 1);
app.use(helmet());
app.use(cors({ origin: process.env.FRONTEND_ORIGIN || '*', credentials: true }));
app.use(express.json({ limit: '2mb' }));
app.use(morgan('combined'));
app.use(rateLimit({ windowMs: 60000, max: 300 }));

app.use('/api/auth',          require('./routes/auth'));
app.use('/api/auth_settings', require('./routes/auth_settings'));
app.use('/api/dashboard',     require('./routes/dashboard'));
app.use('/api/events',        require('./routes/events'));
app.use('/api/blocklists',    require('./routes/blocklists'));
app.use('/api/rules',         require('./routes/rules'));
app.use('/api/settings',      require('./routes/settings'));
app.use('/api/surbl',         require('./routes/surbl'));
app.use('/api/alerts',        require('./routes/alerts'));
app.use('/api/reports',       require('./routes/reports'));
app.use('/api/geo',           require('./routes/geo'));
app.use('/api/health',        require('./routes/health'));
app.use('/api/quarantine',    require('./routes/quarantine'));
app.use('/api/config',        require('./routes/config'));
app.use('/api/bayes',         require('./routes/bayes'));
app.use('/api/queue',         require('./routes/queue'));
app.use('/api/restart',       require('./routes/restart'));
app.use('/api/suggestions',   require('./routes/suggestions'));

app.get('/health', (_, res) => res.json({ status: 'ok', ts: new Date() }));
app.use((err, req, res, _next) => {
  console.error(err);
  res.status(err.status || 500).json({ error: err.message || 'Internal error' });
});

initWss(server);
initGeoIp().catch(e => console.warn('[geoip] init failed:', e.message));
scheduleJobs();

// Render the Postfix dynamic maps from the current DB state on startup.
// Reload isn't attempted here — the postfix container reads the files when
// it starts. The reload path is only used for live mutations.
regenerateRules()
  .then(s => console.log(
    `[postfix-rules] startup: ${s.subject_rules} subject, ${s.from_rules} from, ${s.body_rules} body, ${s.whitelist_rules} whitelist, ${s.skipped} skipped`))
  .catch(e => console.warn('[postfix-rules] startup regen failed:', e.message));

// Render the milter's compound-rule file (multi-condition SMTP-time rejects).
regenerateCompoundRules()
  .then(s => console.log(
    `[compound-rules] startup: ${s.compound_rules} compound, ${s.skipped_non_compound} legacy skipped`))
  .catch(e => console.warn('[compound-rules] startup regen failed:', e.message));

const PORT = process.env.API_PORT || 3001;
server.listen(PORT, () => console.log(`MailGuard API on :${PORT}`));