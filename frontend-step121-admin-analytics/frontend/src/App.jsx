import { lazy, Suspense } from 'react';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import DocumentTitleManager from './components/DocumentTitleManager';
import PushSetup from './components/PushSetup';
import BehaviorCollector from './components/BehaviorCollector';
import RouteWarmup from './components/RouteWarmup';
import ShellLayout from './components/ShellLayout';
import { AuthGate, GuestGate } from './components/AuthGate';
import AdminGate from './components/AdminGate';
import { PERMISSIONS } from './services/permissions';
import {
  loadAdminAnalytics,
  loadAdminUsers,
  loadCommunities,
  loadDevices,
  loadDeviceSettings,
  loadFeed,
  loadMessages,
  loadModerationDesk,
  loadNotifications,
  loadPeople,
  loadProfile,
  loadRecoveryRequests,
  loadSaved,
  loadSearch,
  loadSupport,
} from './routeLoaders';


const Login = lazy(() => import('./pages/auth/Login'));
const Register = lazy(() => import('./pages/auth/Register'));
const SetupSecurity = lazy(() => import('./pages/auth/SetupSecurity'));
const Recovery = lazy(() => import('./pages/auth/Recovery'));
const NotFound = lazy(() => import('./pages/auth/NotFound'));
const RecoveryRequest = lazy(() => import('./pages/auth/RecoveryRequest'));
const RecoveryStatus = lazy(() => import('./pages/auth/RecoveryStatus'));
const RecoverySetup = lazy(() => import('./pages/auth/RecoverySetup'));
const ResetPassword = lazy(() => import('./pages/auth/ResetPassword'));

const Profile = lazy(loadProfile);
const SetupDFSN = lazy(() => import('./pages/profile/SetupDFSN'));
const Feed = lazy(loadFeed);
const Messages = lazy(loadMessages);
const People = lazy(loadPeople);
const Search = lazy(loadSearch);
const Communities = lazy(loadCommunities);
const Notifications = lazy(loadNotifications);
const SavedCollections = lazy(loadSaved);
const Devices = lazy(loadDevices);
const Support = lazy(loadSupport);
const DeviceSettings = lazy(loadDeviceSettings);
const RecoveryRequests = lazy(loadRecoveryRequests);
const ModerationDesk = lazy(loadModerationDesk);
const AdminUsers = lazy(loadAdminUsers);
const AdminAnalytics = lazy(loadAdminAnalytics);

function RouteFallback() {
  return (
    <div className="auth-gate-screen">
      <div className="auth-gate-card">
        <div className="auth-gate-spinner" aria-hidden="true" />
        <div className="auth-gate-title">Загружаем экран</div>
        <div className="auth-gate-text">Подготавливаем интерфейс…</div>
      </div>
    </div>
  );
}

function App() {
  return (
    <BrowserRouter>
      <DocumentTitleManager />
      <BehaviorCollector />
      <RouteWarmup />
      <Suspense fallback={<RouteFallback />}>
        <Routes>
          <Route element={<GuestGate />}>
            <Route path="/" element={<Login />} />
            <Route path="/login" element={<Login />} />
            <Route path="/register" element={<Register />} />
            <Route path="/recovery" element={<Recovery />} />
            <Route path="/recovery-request" element={<RecoveryRequest />} />
            <Route path="/recovery/status/:code" element={<RecoveryStatus />} />
            <Route path="/recovery/setup/:code" element={<RecoverySetup />} />
            <Route path="/reset-password" element={<ResetPassword />} />
          </Route>

          <Route element={<AuthGate />}>
            <Route path="/setup-security" element={<SetupSecurity />} />
            <Route path="/setup-dfsn" element={<SetupDFSN />} />

            <Route element={<ShellLayout />}>
              <Route path="/profile" element={<Profile />} />
              <Route path="/profile/:userId" element={<Profile />} />
              <Route path="/feed" element={<Feed />} />
              <Route path="/messages" element={<Messages />} />
              <Route path="/messages/:userId" element={<Messages />} />
              <Route path="/friends" element={<People />} />
              <Route path="/search" element={<Search />} />
              <Route path="/communities" element={<Communities />} />
              <Route path="/notifications" element={<Notifications />} />
              <Route path="/saved" element={<SavedCollections />} />
              <Route path="/settings/devices" element={<Devices />} />
              <Route path="/settings/support" element={<Support />} />
              <Route path="/settings/devices/:deviceId" element={<DeviceSettings />} />
              <Route element={<AdminGate permission={PERMISSIONS.RECOVERY_REVIEW} />}>
                <Route path="/admin/recovery-requests" element={<RecoveryRequests />} />
              </Route>
              <Route element={<AdminGate permission={PERMISSIONS.USERS_MODERATE} />}>
                <Route path="/admin/moderation" element={<ModerationDesk />} />
              </Route>
              <Route element={<AdminGate permission={PERMISSIONS.ADMIN_PANEL} />}>
                <Route path="/admin/users" element={<AdminUsers />} />
                <Route path="/admin/analytics" element={<AdminAnalytics />} />
              </Route>
            </Route>
          </Route>

          <Route path="*" element={<NotFound />} />
        </Routes>
      </Suspense>
      <PushSetup />
    </BrowserRouter>
  );
}

export default App;
