import 'dotenv/config';
import express from 'express';
import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import crypto from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT || 3000);
const JWT_SECRET = process.env.JWT_SECRET || '';
const HISTORY_DAYS = Math.max(1, Number(process.env.HISTORY_DAYS || 30));
const HISTORY_SAMPLE_SECONDS = Math.max(10, Number(process.env.HISTORY_SAMPLE_SECONDS || 60));
const ALLOWED_EMAIL_DOMAIN = '@prajgenx.net';
const isProduction = process.env.NODE_ENV === 'production';

if (!process.env.MONGODB_URI) throw new Error('Set MONGODB_URI in your .env file before starting the app.');
if (JWT_SECRET.length < 32) throw new Error('Set JWT_SECRET to a random secret with at least 32 characters.');

const userSchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true, maxlength: 100 },
  email: { type: String, required: true, unique: true, lowercase: true, trim: true, maxlength: 254 },
  passwordHash: { type: String, required: true },
  destination: {
    lat: { type: Number, min: -90, max: 90 },
    lon: { type: Number, min: -180, max: 180 },
    updatedAt: Date,
  },
}, { timestamps: true });

const pointSchema = new mongoose.Schema({
  lat: { type: Number, required: true, min: -90, max: 90 },
  lon: { type: Number, required: true, min: -180, max: 180 },
  recordedAt: { type: Date, required: true },
}, { _id: false });

const tripSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  phone: { type: String, required: true, trim: true },
  tokenHash: { type: String, required: true, unique: true, select: false },
  status: { type: String, enum: ['Awaiting acceptance', 'On the way', 'Reached'], default: 'Awaiting acceptance' },
  createdAt: { type: Date, default: Date.now },
  latestLocation: pointSchema,
  history: { type: [pointSchema], default: [] },
});

const User = mongoose.model('User', userSchema);
const Trip = mongoose.model('Trip', tripSchema);
const app = express();
app.disable('x-powered-by');
app.set('trust proxy', isProduction ? 1 : false);
app.use(helmet());
app.use(express.json({ limit: '20kb' }));
app.use(cookieParser());

const authLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 20, standardHeaders: 'draft-8', legacyHeaders: false });
const gpsLimiter = rateLimit({ windowMs: 60 * 1000, limit: 120, standardHeaders: 'draft-8', legacyHeaders: false });
const cookieOptions = {
  httpOnly: true,
  secure: isProduction,
  sameSite: 'lax',
  path: '/',
  maxAge: 7 * 24 * 60 * 60 * 1000,
};

function signInCookie(res, user) {
  const session = jwt.sign({ sub: user.id }, JWT_SECRET, { expiresIn: '7d', issuer: 'haulmark' });
  res.cookie('haulmark_session', session, cookieOptions);
}
function validCoordinate(lat, lon) {
  return Number.isFinite(lat) && Number.isFinite(lon) && Math.abs(lat) <= 90 && Math.abs(lon) <= 180;
}
function distanceKm(a, b) {
  const radians = degrees => degrees * Math.PI / 180;
  const dLat = radians(b.lat - a.lat), dLon = radians(b.lon - a.lon);
  const x = Math.sin(dLat / 2) ** 2 + Math.cos(radians(a.lat)) * Math.cos(radians(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 6371.0088 * 2 * Math.atan2(Math.sqrt(x), Math.sqrt(1 - x));
}
function locationLinks(location, destination) {
  if (!location) return { locationUrl: null, routeUrl: null, distanceKm: null };
  const locationUrl = `https://maps.google.com/?q=${location.lat},${location.lon}`;
  if (!destination || !validCoordinate(destination.lat, destination.lon)) return { locationUrl, routeUrl: null, distanceKm: null };
  return {
    locationUrl,
    routeUrl: `https://www.google.com/maps/dir/?api=1&origin=${location.lat},${location.lon}&destination=${destination.lat},${destination.lon}&travelmode=driving`,
    distanceKm: Math.round(distanceKm(location, destination) * 10) / 10,
  };
}
function publicTrip(trip, destination) {
  const links = locationLinks(trip.latestLocation, destination);
  const status = trip.status === 'Reached' || (links.distanceKm != null && links.distanceKm <= 0.1)
    ? 'Reached'
    : trip.latestLocation ? 'On the way' : 'Awaiting acceptance';
  return {
    id: String(trip._id || trip.id),
    phone: trip.phone,
    status,
    createdAt: trip.createdAt,
    locationUpdatedAt: trip.latestLocation?.recordedAt || null,
    historyCount: trip.history.length,
    ...links,
  };
}
async function requireAuth(req, res, next) {
  try {
    const raw = req.cookies.haulmark_session;
    if (!raw) return res.status(401).json({ error: 'Sign in to continue.' });
    const payload = jwt.verify(raw, JWT_SECRET, { issuer: 'haulmark' });
    const user = await User.findById(payload.sub).select('_id name email destination');
    if (!user) return res.status(401).json({ error: 'Your session has expired. Sign in again.' });
    if (!user.email.toLowerCase().endsWith(ALLOWED_EMAIL_DOMAIN)) {
      res.clearCookie('haulmark_session', cookieOptions);
      return res.status(403).json({ error: 'Access is limited to @prajgenx.net email addresses.' });
    }
    req.user = user;
    next();
  } catch {
    res.clearCookie('haulmark_session', cookieOptions);
    return res.status(401).json({ error: 'Your session has expired. Sign in again.' });
  }
}

app.post('/api/auth/register', authLimiter, async (req, res) => {
  const name = String(req.body.name || '').trim();
  const email = String(req.body.email || '').trim().toLowerCase();
  const password = String(req.body.password || '');
  if (name.length < 2) return res.status(400).json({ error: 'Enter your name.' });
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return res.status(400).json({ error: 'Enter a valid email address.' });
  if (!email.endsWith(ALLOWED_EMAIL_DOMAIN)) return res.status(403).json({ error: 'Register with your @prajgenx.net email address.' });
  if (password.length < 10) return res.status(400).json({ error: 'Use a password with at least 10 characters.' });
  try {
    const user = await User.create({ name, email, passwordHash: await bcrypt.hash(password, 12) });
    signInCookie(res, user);
    return res.status(201).json({ user: { id: user.id, name: user.name, email: user.email } });
  } catch (error) {
    if (error.code === 11000) return res.status(409).json({ error: 'An account with this email already exists.' });
    throw error;
  }
});

app.post('/api/auth/login', authLimiter, async (req, res) => {
  const email = String(req.body.email || '').trim().toLowerCase();
  const password = String(req.body.password || '');
  if (!email.endsWith(ALLOWED_EMAIL_DOMAIN)) return res.status(403).json({ error: 'Sign in with your @prajgenx.net email address.' });
  const user = await User.findOne({ email });
  if (!user || !(await bcrypt.compare(password, user.passwordHash))) {
    return res.status(401).json({ error: 'Email or password is incorrect.' });
  }
  signInCookie(res, user);
  return res.json({ user: { id: user.id, name: user.name, email: user.email } });
});

app.post('/api/auth/logout', (req, res) => {
  res.clearCookie('haulmark_session', cookieOptions);
  res.status(204).end();
});

app.get('/api/auth/me', async (req, res) => {
  const raw = req.cookies.haulmark_session;
  if (!raw) return res.json({ user: null });
  try {
    const payload = jwt.verify(raw, JWT_SECRET, { issuer: 'haulmark' });
    const user = await User.findById(payload.sub).select('_id name email');
    if (user && !user.email.toLowerCase().endsWith(ALLOWED_EMAIL_DOMAIN)) {
      res.clearCookie('haulmark_session', cookieOptions);
      return res.status(403).json({ user: null, error: 'Access is limited to @prajgenx.net email addresses.' });
    }
    return res.json({ user: user ? { id: user.id, name: user.name, email: user.email } : null });
  } catch {
    res.clearCookie('haulmark_session', cookieOptions);
    return res.json({ user: null });
  }
});

app.get('/api/config', requireAuth, (req, res) => res.json({
  destinationConfigured: Boolean(req.user.destination?.lat !== undefined && req.user.destination?.lon !== undefined),
  destination: req.user.destination?.lat !== undefined ? { lat: req.user.destination.lat, lon: req.user.destination.lon } : null,
  distanceType: 'straight-line',
  historyDays: HISTORY_DAYS,
}));

app.post('/api/destination', requireAuth, async (req, res) => {
  const { lat, lon } = req.body;
  if (!validCoordinate(lat, lon)) return res.status(400).json({ error: 'Valid latitude and longitude are required.' });
  req.user.destination = { lat, lon, updatedAt: new Date() };
  await req.user.save();
  return res.json({ ok: true, destination: { lat, lon } });
});

app.get('/api/trips', requireAuth, async (req, res) => {
  const trips = await Trip.find({ userId: req.user.id }).sort({ createdAt: -1 }).lean();
  return res.json(trips.map(trip => publicTrip(trip, req.user.destination)));
});

app.post('/api/trips', requireAuth, async (req, res) => {
  const phone = String(req.body.phone || '').trim();
  const digits = phone.replace(/\D/g, '');
  if (digits.length < 7 || digits.length > 15) return res.status(400).json({ error: 'Enter a valid mobile number.' });
  const token = crypto.randomBytes(32).toString('base64url');
  const trip = await Trip.create({ userId: req.user.id, phone, tokenHash: crypto.createHash('sha256').update(token).digest('hex') });
  const configuredBaseUrl = process.env.PUBLIC_BASE_URL;
  const invalidProductionBase = isProduction && configuredBaseUrl && /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?\/?$/i.test(configuredBaseUrl);
  const baseUrl = (configuredBaseUrl && !invalidProductionBase ? configuredBaseUrl : isProduction ? `${req.protocol}://${req.get('host')}` : req.get('origin') || `http://localhost:${PORT}`).replace(/\/$/, '');
  return res.status(201).json({ trip: publicTrip(trip, req.user.destination), supplierUrl: `${baseUrl}/track/${token}` });
});

app.get('/api/history', requireAuth, async (req, res) => {
  const trips = await Trip.find({ userId: req.user.id }).sort({ createdAt: -1 }).lean();
  return res.json(trips.map(trip => publicTrip(trip, req.user.destination)));
});

app.get('/api/history/:id', requireAuth, async (req, res) => {
  const trip = await Trip.findOne({ _id: req.params.id, userId: req.user.id }).lean();
  if (!trip) return res.status(404).json({ error: 'Tracking history was not found.' });
  return res.json({
    id: String(trip._id),
    phone: trip.phone,
    createdAt: trip.createdAt,
    status: trip.status,
    points: trip.history.map(point => ({
      ...point,
      ...locationLinks(point, req.user.destination),
    })),
  });
});

app.get('/api/supplier/:token', async (req, res) => {
  const tokenHash = crypto.createHash('sha256').update(req.params.token).digest('hex');
  const trip = await Trip.findOne({ tokenHash }).select('+tokenHash').lean();
  if (!trip) return res.status(404).json({ error: 'This tracking link is invalid or expired.' });
  const user = await User.findById(trip.userId).select('destination').lean();
  const destination = user?.destination;
  return res.json({
    destinationConfigured: Boolean(destination?.lat !== undefined && destination?.lon !== undefined),
    distanceKm: locationLinks(trip.latestLocation, destination).distanceKm,
    locationUrl: locationLinks(trip.latestLocation, destination).locationUrl,
    routeUrl: locationLinks(trip.latestLocation, destination).routeUrl,
    locationUpdatedAt: trip.latestLocation?.recordedAt || null,
  });
});

app.post('/api/supplier/:token/location', gpsLimiter, async (req, res) => {
  const { lat, lon } = req.body;
  if (!validCoordinate(lat, lon)) return res.status(400).json({ error: 'Valid latitude and longitude are required.' });
  const tokenHash = crypto.createHash('sha256').update(req.params.token).digest('hex');
  const trip = await Trip.findOne({ tokenHash }).select('+tokenHash');
  if (!trip) return res.status(404).json({ error: 'This tracking link is invalid or expired.' });
  const owner = await User.findById(trip.userId).select('destination').lean();
  const now = new Date();
  const lastSample = trip.history.at(-1);
  trip.latestLocation = { lat, lon, recordedAt: now };
  const distanceKmLeft = locationLinks(trip.latestLocation, owner?.destination).distanceKm;
  if (trip.status !== 'Reached') {
    trip.status = distanceKmLeft != null && distanceKmLeft <= 0.1 ? 'Reached' : 'On the way';
  }
  if (!lastSample || now.getTime() - lastSample.recordedAt.getTime() >= HISTORY_SAMPLE_SECONDS * 1000) {
    trip.history.push({ lat, lon, recordedAt: now });
  }
  await trip.save();
  return res.json({ ok: true });
});

app.use((error, req, res, next) => {
  console.error(error);
  if (res.headersSent) return next(error);
  return res.status(500).json({ error: 'Server error. Please try again.' });
});

if (isProduction) {
  const clientDist = path.join(__dirname, 'client', 'dist');
  app.use(express.static(clientDist));
  app.get(/^(?!\/api(?:\/|$)).*/, (req, res) => res.sendFile(path.join(clientDist, 'index.html')));
}

async function removeExpiredTrips() {
  const cutoff = new Date(Date.now() - HISTORY_DAYS * 24 * 60 * 60 * 1000);
  await Trip.deleteMany({ createdAt: { $lt: cutoff } });
}

await mongoose.connect(process.env.MONGODB_URI);
await Trip.updateMany({ status: 'Awaiting location' }, { $set: { status: 'Awaiting acceptance' } });
await removeExpiredTrips();
const retentionTimer = setInterval(() => removeExpiredTrips().catch(error => console.error('History retention cleanup failed:', error)), 60 * 60 * 1000);
retentionTimer.unref();
app.listen(PORT, () => console.log(`Haulmark API listening on http://localhost:${PORT}; retaining ${HISTORY_DAYS} days of tracking history.`));
