import { lazy, Suspense, type ReactNode } from "react";
import { Navigate, Route, Routes } from "react-router";

import { AppShell } from "./components/AppShell";
import { AppDataProvider } from "./lib/app-data";
import { APP_VERSION } from "./lib/app-version";
import { isDevelopmentVersion } from "./lib/release-notes";
import { ScanJobsProvider } from "./lib/scan-jobs";
import { ThemeProvider } from "./lib/theme";

const DashboardPage = lazy(() => import("./pages/DashboardPage").then((module) => ({ default: module.DashboardPage })));
const FileComparePage = lazy(() => import("./pages/FileComparePage").then((module) => ({ default: module.FileComparePage })));
const FileDetailPage = lazy(() => import("./pages/FileDetailPage").then((module) => ({ default: module.FileDetailPage })));
const LibrariesPage = lazy(() => import("./pages/LibrariesPage").then((module) => ({ default: module.LibrariesPage })));
const LibraryDetailPage = lazy(() => import("./pages/LibraryDetailPage").then((module) => ({ default: module.LibraryDetailPage })));
const SeriesDetailPage = lazy(() => import("./pages/SeriesDetailPage").then((module) => ({ default: module.SeriesDetailPage })));
const StorageMapPage = lazy(() => import("./pages/StorageMapPage").then((module) => ({ default: module.StorageMapPage })));
const TranscodingPage = lazy(() => import("./pages/TranscodingPage").then((module) => ({ default: module.TranscodingPage })));
const UiElementsPage = lazy(() => import("./pages/UiElementsPage").then((module) => ({ default: module.UiElementsPage })));

function DevOnlyRoute({ children }: { children: ReactNode }) {
  return isDevelopmentVersion(APP_VERSION) ? children : <Navigate to="/" replace />;
}

export function App() {
  return (
    <ThemeProvider>
      <ScanJobsProvider>
        <AppDataProvider>
          <Suspense fallback={<div className="empty-state" aria-busy="true" />}>
            <Routes>
              <Route element={<AppShell />}>
                <Route path="/" element={<DashboardPage />} />
                <Route path="/settings" element={<LibrariesPage />} />
                <Route
                  path="/ui-elements"
                  element={
                    <DevOnlyRoute>
                      <UiElementsPage />
                    </DevOnlyRoute>
                  }
                />
                <Route path="/libraries/:libraryId/series/:seriesId" element={<SeriesDetailPage />} />
                <Route path="/libraries/:libraryId" element={<LibraryDetailPage />} />
                <Route path="/files/compare" element={<FileComparePage />} />
                <Route path="/files/:fileId/preview" element={<FileDetailPage />} />
                <Route path="/files/:fileId" element={<FileDetailPage />} />
                <Route path="/storage-map" element={<StorageMapPage />} />
                <Route path="/transcoding" element={<TranscodingPage />} />
                <Route path="*" element={<Navigate to="/" replace />} />
              </Route>
            </Routes>
          </Suspense>
        </AppDataProvider>
      </ScanJobsProvider>
    </ThemeProvider>
  );
}
