import type { ReactNode } from "react";
import { Navigate, Route, Routes } from "react-router-dom";

import { AppShell } from "./components/AppShell";
import { AppDataProvider } from "./lib/app-data";
import { APP_VERSION } from "./lib/app-version";
import { isDevelopmentVersion } from "./lib/release-notes";
import { ScanJobsProvider } from "./lib/scan-jobs";
import { ThemeProvider } from "./lib/theme";
import { DashboardPage } from "./pages/DashboardPage";
import { FileDetailPage } from "./pages/FileDetailPage";
import { LibrariesPage } from "./pages/LibrariesPage";
import { LibraryDetailPage } from "./pages/LibraryDetailPage";
import { SeriesDetailPage } from "./pages/SeriesDetailPage";
import { UiElementsPage } from "./pages/UiElementsPage";

function DevOnlyRoute({ children }: { children: ReactNode }) {
  return isDevelopmentVersion(APP_VERSION) ? children : <Navigate to="/" replace />;
}

export function App() {
  return (
    <ThemeProvider>
      <ScanJobsProvider>
        <AppDataProvider>
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
              <Route path="/files/:fileId" element={<FileDetailPage />} />
              <Route path="*" element={<Navigate to="/" replace />} />
            </Route>
          </Routes>
        </AppDataProvider>
      </ScanJobsProvider>
    </ThemeProvider>
  );
}
