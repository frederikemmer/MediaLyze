import { useEffect, useMemo, useState, type MouseEvent, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import {
  AlertTriangle,
  Activity,
  ArrowLeft,
  ArrowUp,
  ArrowUpRight,
  AudioLines,
  Ban,
  CalendarDays,
  Check,
  Captions,
  Clock3,
  CircleStop,
  CircleX,
  ChevronDown,
  ChevronRight,
  Columns3,
  Columns3Cog,
  Copy,
  Cpu,
  Database,
  Diff,
  Download,
  Eye,
  EyeOff,
  FileCheckCorner,
  FileDiff,
  FileExclamationPoint,
  FilePlusCorner,
  FileSearchCorner,
  FileText,
  FileVideo,
  Files,
  Film,
  Folder,
  FlaskConical,
  GitCompare,
  Gauge,
  Gpu,
  Hash,
  History,
  HardDrive,
  House,
  KeyRound,
  Info,
  Layers,
  LayoutPanelTop,
  Link2,
  ListFilter,
  Lock,
  Map,
  Network,
  PanelBottomClose,
  PanelLeftClose,
  PanelRightClose,
  PanelTopClose,
  Percent,
  Play,
  Plus,
  PlugZap,
  RefreshCw,
  RotateCcw,
  Save,
  SaveOff,
  Search,
  Settings,
  Square,
  Server,
  SlidersHorizontal,
  Sparkles,
  Star,
  SquareArrowOutUpRight,
  Trash2,
  Unplug,
  UserRoundCheck,
  X,
} from "lucide-react";

import { AnimatedConnectIcon } from "../components/AnimatedConnectIcon";
import { AnimatedSearchIcon } from "../components/AnimatedSearchIcon";
import { AsyncPanel } from "../components/AsyncPanel";
import { ComparisonChartPanel } from "../components/ComparisonChartPanel";
import { DistributionChartPanel } from "../components/DistributionChartPanel";
import { DistributionList } from "../components/DistributionList";
import { DuplicatePanelEmptyState } from "../components/DuplicatePanelEmptyState";
import { ChevronsRightLeftIcon } from "../components/ChevronsRightLeftIcon";
import { CheckIcon } from "../components/CheckIcon";
import { CopyIcon } from "../components/CopyIcon";
import { DashboardVisibilityIcon } from "../components/DashboardVisibilityIcon";
import { DeleteIcon } from "../components/DeleteIcon";
import { GitCompareArrowsIcon } from "../components/GitCompareArrowsIcon";
import { GithubIcon } from "../components/GithubIcon";
import { JellyfinIcon } from "../components/JellyfinIcon";
import { ConnectorProviderIcon } from "../components/ConnectorProviderIcon";
import { ConnectorStreamingDetails } from "../components/JellyfinMetadataDetails";
import { AudioStreamPrimaryToggle, type AudioStreamPrimaryMode } from "../components/AudioStreamPrimaryToggle";
import { PanelEmptyState } from "../components/PanelEmptyState";
import { PathBrowser } from "../components/PathBrowser";
import { PathSegmentTrail } from "../components/PathSegmentTrail";
import { PanelLeftToggleIcon } from "../components/PanelLeftToggleIcon";
import { ProfileFavoriteButton } from "../components/ProfileFavoriteButton";
import { SlidingTogglePill } from "../components/SlidingTogglePill";
import { SparklesIcon as AnimatedSparklesIcon } from "../components/SparklesIcon";
import { SquarePenIcon } from "../components/SquarePenIcon";
import { StatCard } from "../components/StatCard";
import { StatisticPanelLayoutControls } from "../components/StatisticPanelLayoutControls";
import { StatisticPanelLayoutMigrationNotice } from "../components/StatisticPanelLayoutMigrationNotice";
import { StreamDetailsList } from "../components/StreamDetailsList";
import { TableViewSettingsEditor } from "../components/TableViewSettingsEditor";
import { TelemetryModeToggle } from "../components/TelemetryModeToggle";
import { TooltipTrigger } from "../components/TooltipTrigger";
import { VideoWipeCompare } from "../components/VideoWipeCompare";
import { api, type BrowseResponse, type ComparisonResponse, type MediaFileStreamDetails } from "../lib/api";
import { buildDefaultLibraryStatisticsSettings } from "../lib/library-statistics-settings";
import type { ComparisonSelection } from "../lib/statistic-comparisons";
import type { StatisticPanelLayoutMenuDefinition } from "../lib/statistic-panel-layout";
import { useTheme, type ThemePreference } from "../lib/theme";

type CatalogSectionId =
  | "foundation"
  | "header-nav"
  | "settings"
  | "forms"
  | "buttons"
  | "panels"
  | "tables"
  | "stats"
  | "runtime"
  | "file-library"
  | "duplicates-path-telemetry"
  | "dialogs";

type CatalogSectionDefinition = {
  id: CatalogSectionId;
  titleKey: string;
  descriptionKey: string;
};

const catalogSections: CatalogSectionDefinition[] = [
  { id: "foundation", titleKey: "uiElements.sections.foundation", descriptionKey: "uiElements.descriptions.foundation" },
  { id: "header-nav", titleKey: "uiElements.sections.headerNav", descriptionKey: "uiElements.descriptions.headerNav" },
  { id: "settings", titleKey: "uiElements.sections.settings", descriptionKey: "uiElements.descriptions.settings" },
  { id: "forms", titleKey: "uiElements.sections.forms", descriptionKey: "uiElements.descriptions.forms" },
  { id: "buttons", titleKey: "uiElements.sections.buttons", descriptionKey: "uiElements.descriptions.buttons" },
  { id: "panels", titleKey: "uiElements.sections.panels", descriptionKey: "uiElements.descriptions.panels" },
  { id: "tables", titleKey: "uiElements.sections.tables", descriptionKey: "uiElements.descriptions.tables" },
  { id: "stats", titleKey: "uiElements.sections.stats", descriptionKey: "uiElements.descriptions.stats" },
  { id: "runtime", titleKey: "uiElements.sections.runtime", descriptionKey: "uiElements.descriptions.runtime" },
  { id: "file-library", titleKey: "uiElements.sections.fileLibrary", descriptionKey: "uiElements.descriptions.fileLibrary" },
  {
    id: "duplicates-path-telemetry",
    titleKey: "uiElements.sections.duplicatesPathTelemetry",
    descriptionKey: "uiElements.descriptions.duplicatesPathTelemetry",
  },
  { id: "dialogs", titleKey: "uiElements.sections.dialogs", descriptionKey: "uiElements.descriptions.dialogs" },
];

function preventCatalogNavigation(event: MouseEvent<HTMLAnchorElement>) {
  event.preventDefault();
}

const colorTokens = [
  { name: "--bg", value: "var(--bg)" },
  { name: "--bg-alt", value: "var(--bg-alt)" },
  { name: "--ink", value: "var(--ink)" },
  { name: "--muted", value: "var(--muted)" },
  { name: "--panel", value: "var(--panel)" },
  { name: "--panel-strong", value: "var(--panel-strong)" },
  { name: "--surface", value: "var(--surface)" },
  { name: "--surface-subtle", value: "var(--surface-subtle)" },
  { name: "--border", value: "var(--border)" },
  { name: "--scrollbar-thumb", value: "var(--scrollbar-thumb)" },
  { name: "--scrollbar-thumb-hover", value: "var(--scrollbar-thumb-hover)" },
  { name: "--accent", value: "var(--accent)" },
  { name: "--accent-2", value: "var(--accent-2)" },
  { name: "--accent-3", value: "var(--accent-3)" },
];

const distributionItems = [
  { label: "HEVC", value: 42 },
  { label: "H.264", value: 31 },
  { label: "AV1", value: 12 },
  { label: "ProRes", value: 5 },
];

const numericDistribution = {
  total: 128,
  bins: [
    { lower: null, upper: 50, count: 8, percentage: 6.25 },
    { lower: 50, upper: 70, count: 26, percentage: 20.3 },
    { lower: 70, upper: 85, count: 54, percentage: 42.2 },
    { lower: 85, upper: null, count: 40, percentage: 31.25 },
  ],
};

const comparisonResponse: ComparisonResponse = {
  x_field: "duration",
  y_field: "size",
  x_field_kind: "numeric",
  y_field_kind: "numeric",
  available_renderers: ["heatmap", "scatter", "bar"],
  total_files: 128,
  included_files: 118,
  excluded_files: 10,
  sampled_points: false,
  sample_limit: 5000,
  x_buckets: [
    { key: "0:3600", label: "0:3600", lower: 0, upper: 3600 },
    { key: "3600:7200", label: "3600:7200", lower: 3600, upper: 7200 },
    { key: "7200:null", label: "7200:null", lower: 7200, upper: null },
  ],
  y_buckets: [
    { key: "0:8000000000", label: "0:8000000000", lower: 0, upper: 8000000000 },
    { key: "8000000000:24000000000", label: "8000000000:24000000000", lower: 8000000000, upper: 24000000000 },
    { key: "24000000000:null", label: "24000000000:null", lower: 24000000000, upper: null },
  ],
  heatmap_cells: [
    { x_key: "0:3600", y_key: "0:8000000000", count: 18 },
    { x_key: "3600:7200", y_key: "8000000000:24000000000", count: 42 },
    { x_key: "7200:null", y_key: "24000000000:null", count: 16 },
  ],
  scatter_points: [
    { media_file_id: 1, asset_name: "Arrival.2016.UHD.mkv", x_value: 6960, y_value: 18400000000 },
    { media_file_id: 2, asset_name: "Concert.Live.flac", x_value: 4380, y_value: 870000000 },
    { media_file_id: 3, asset_name: "Archive.Sample.mov", x_value: 9300, y_value: 42000000000 },
  ],
  bar_entries: [
    { x_key: "0:3600", x_label: "Short", value: 6200000000, count: 18 },
    { x_key: "3600:7200", x_label: "Feature", value: 16400000000, count: 42 },
    { x_key: "7200:null", x_label: "Long", value: 31000000000, count: 16 },
  ],
};

const mockBrowseResponses: Record<string, BrowseResponse> = {
  ".": {
    current_path: ".",
    parent_path: null,
    entries: [
      { name: "Movies", path: "Movies", is_dir: true },
      { name: "Music", path: "Music", is_dir: true },
      { name: "Series", path: "Series", is_dir: true },
    ],
  },
  Movies: {
    current_path: "Movies",
    parent_path: ".",
    entries: [
      { name: "Arrival", path: "Movies/Arrival", is_dir: true },
      { name: "Concerts", path: "Movies/Concerts", is_dir: true },
    ],
  },
  Music: {
    current_path: "Music",
    parent_path: ".",
    entries: [
      { name: "Live", path: "Music/Live", is_dir: true },
      { name: "Albums", path: "Music/Albums", is_dir: true },
    ],
  },
  Series: {
    current_path: "Series",
    parent_path: ".",
    entries: [{ name: "Documentaries", path: "Series/Documentaries", is_dir: true }],
  },
};

const streamDetails: MediaFileStreamDetails = {
  id: 1,
  video_streams: [
    {
      stream_index: 0,
      codec: "hevc",
      profile: "Main 10",
      width: 3840,
      height: 2160,
      pix_fmt: "yuv420p10le",
      color_space: "bt2020nc",
      color_transfer: "smpte2084",
      color_primaries: "bt2020",
      frame_rate: 23.976,
      bit_rate: 18400000,
      bit_depth: 10,
      hdr_type: "hdr10",
    },
  ],
  audio_streams: [
    {
      stream_index: 1,
      codec: "eac3",
      profile: "Dolby Digital Plus",
      spatial_audio_profile: "dolby_atmos",
      channels: 6,
      channel_layout: "5.1",
      sample_rate: 48000,
      bit_rate: 768000,
      bit_depth: 24,
      bit_rate_mode: "CBR",
      compression_mode: "lossy",
      replay_gain: null,
      replay_gain_peak: null,
      writing_library: "Lavf",
      md5_unencoded: null,
      language: "en",
      default_flag: true,
      forced_flag: false,
    },
  ],
  subtitle_streams: [
    { stream_index: 2, codec: "subrip", language: "de", default_flag: false, forced_flag: false, subtitle_type: "text" },
  ],
  external_subtitles: [{ id: 1, path: "Arrival.2016.de.srt", language: "de", format: "srt" }],
};

const availablePanelDefinitions: StatisticPanelLayoutMenuDefinition[] = [
  { id: "quality_score", nameKey: "dashboard.qualityScoreDistribution" },
  { id: "comparison", nameKey: "dashboard.comparisonPanel" },
  { id: "history", nameKey: "dashboard.history.title" },
];

function CatalogSection({
  definition,
  children,
}: {
  definition: CatalogSectionDefinition;
  children: ReactNode;
}) {
  const { t } = useTranslation();
  return (
    <section id={definition.id} className="panel ui-elements-section">
      <div className="panel-title-row">
        <h2>{t(definition.titleKey)}</h2>
      </div>
      <p className="subtitle">{t(definition.descriptionKey)}</p>
      <div className="ui-elements-section-body">{children}</div>
    </section>
  );
}

function VariantGroup({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="ui-elements-variant-group">
      <h3>{title}</h3>
      <div className="ui-elements-variant-grid">{children}</div>
    </div>
  );
}

function SourceTag({ source }: { source: string }) {
  return <span className="ui-elements-source-tag">{source}</span>;
}

function ClassList({ classes }: { classes: string[] }) {
  return (
    <div className="ui-elements-class-list" aria-label="CSS classes">
      {classes.map((className) => (
        <code key={className}>{className}</code>
      ))}
    </div>
  );
}

function VariantCard({
  title,
  source,
  classes,
  status,
  children,
  wide = false,
}: {
  title: string;
  source: string;
  classes: string[];
  status?: string;
  children: ReactNode;
  wide?: boolean;
}) {
  return (
    <article className={`ui-elements-variant-card${wide ? " ui-elements-variant-card-wide" : ""}`}>
      <div className="ui-elements-variant-meta">
        <div>
          <strong>{title}</strong>
          {status ? <span>{status}</span> : null}
        </div>
        <SourceTag source={source} />
      </div>
      <div className="ui-elements-variant-preview">{children}</div>
      <ClassList classes={classes} />
    </article>
  );
}

function Badge({ children, className = "badge" }: { children: ReactNode; className?: string }) {
  return <span className={className}>{children}</span>;
}

function ScoreMeter({ value }: { value: number }) {
  return (
    <div className="score-cell">
      <strong>{value}</strong>
      <span className="score-meter">
        <span
          className={`score-meter-fill ${value >= 85 ? "score-meter-fill-high" : value >= 65 ? "score-meter-fill-medium" : "score-meter-fill-low"}`}
          style={{ width: `${value}%` }}
        />
      </span>
    </div>
  );
}

function AnalyzedFilesTable() {
  const rows = [
    { file: "Movies/Arrival.2016.mkv", container: "mkv", codec: "HEVC", quality: 91, size: "18.4 GB" },
    { file: "Series/Example/S01E01.mp4", container: "mp4", codec: "H.264", quality: 76, size: "4.8 GB" },
    { file: "Music/Live Session.flac", container: "flac", codec: "FLAC", quality: 88, size: "624 MB" },
  ];

  return (
    <div className="data-table-shell ui-elements-table-shell">
      <div className="media-data-table">
        <div className="media-data-table-head">
          <div className="media-data-row media-data-head-row ui-elements-data-row">
            {["File", "Container", "Codec", "Quality", "Size"].map((label, index) => (
              <div key={label} className={`media-data-cell media-data-header-cell${index === 0 ? " is-sticky" : ""}`}>
                <button type="button" className="column-sort">
                  {label}
                  <span className={`sort-indicator${index === 0 ? " is-active" : ""}`}>{index === 0 ? "↓" : "↕"}</span>
                </button>
              </div>
            ))}
          </div>
        </div>
        <div className="media-data-table-body is-static-body">
          {rows.map((row) => (
            <div key={row.file} className="media-data-row media-data-body-row is-static-row ui-elements-data-row">
              <div className="media-data-cell is-sticky">
                <span className="file-link">{row.file}</span>
              </div>
              <div className="media-data-cell">{row.container}</div>
              <div className="media-data-cell">{row.codec}</div>
              <div className="media-data-cell">
                <ScoreMeter value={row.quality} />
              </div>
              <div className="media-data-cell">{row.size}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function SettingsNavigationFixture({ collapsed = false, noResults = false }: { collapsed?: boolean; noResults?: boolean }) {
  return (
    <div className={`settings-layout${collapsed ? " is-settings-nav-collapsed" : ""}`}>
      <aside className="settings-navigation-panel" aria-label="Settings navigation">
        <button
          type="button"
          className="settings-mobile-menu-button"
          aria-label="Open settings navigation"
          aria-expanded="false"
          aria-controls="settings-mobile-navigation-menu"
        >
          <span className="settings-mobile-menu-button-content">
            <span className="settings-mobile-menu-current">
              <Folder className="nav-icon" aria-hidden="true" />
              <span>Libraries</span>
            </span>
          </span>
          <ChevronDown aria-hidden="true" className="settings-mobile-menu-chevron" />
        </button>
        <div id="settings-mobile-navigation-menu" className="settings-mobile-navigation-menu" aria-hidden="true">
          <div className="settings-navigation-search-stack settings-mobile-navigation-search-stack">
            <label className="settings-navigation-search settings-mobile-navigation-search">
              <span className="sr-only">Search settings</span>
              <Search aria-hidden="true" />
              <input type="search" value={noResults ? "zzzz" : "Combinaton"} readOnly placeholder="Search settings…" />
            </label>
          </div>
          <nav className="settings-mobile-navigation-list" aria-label="Mobile settings navigation">
            <button type="button" className="settings-navigation-item settings-mobile-navigation-item active" aria-current="page" tabIndex={-1}>
              <span className="nav-active-pill" aria-hidden="true" />
              <span className="settings-navigation-item-content">
                <Folder className="nav-icon" aria-hidden="true" />
                <span>Libraries</span>
              </span>
            </button>
            <button type="button" className="settings-navigation-item settings-mobile-navigation-item" tabIndex={-1}>
              <span className="settings-navigation-item-content">
                <Settings className="nav-icon" aria-hidden="true" />
                <span>App settings</span>
              </span>
            </button>
          </nav>
        </div>
        <div className="settings-navigation-header">
          {!collapsed ? <span>Settings</span> : null}
          <button
            type="button"
            className="secondary icon-only-button settings-navigation-collapse-button"
            aria-label={collapsed ? "Expand settings navigation" : "Collapse settings navigation"}
            title={collapsed ? "Expand settings navigation" : "Collapse settings navigation"}
            aria-expanded={!collapsed}
          >
            <PanelLeftToggleIcon aria-hidden="true" collapsed={collapsed} className="settings-navigation-toggle-icon" size={24} />
          </button>
        </div>
        {!collapsed ? (
          <div className="settings-navigation-search-stack">
            <label className="settings-navigation-search">
              <span className="sr-only">Search settings</span>
              <Search aria-hidden="true" />
              <input type="search" value={noResults ? "zzzz" : "Combinaton"} readOnly placeholder="Search settings…" />
            </label>
            <div className="settings-search-results" role="listbox" aria-label="Settings search results">
              {noResults ? (
                <div className="settings-search-result-empty">No settings match this search.</div>
              ) : (
                <button type="button" role="option" aria-selected="true" className="settings-search-result is-best-match">
                  <span className="settings-search-result-label">Combination</span>
                  <span className="settings-search-result-context">Hardware &amp; software profiles</span>
                </button>
              )}
            </div>
          </div>
        ) : null}
        <nav className="settings-navigation-list">
          <div className="settings-navigation-group">
            {!collapsed ? <div className="settings-navigation-group-label">Libraries &amp; Sources</div> : null}
            <button type="button" className="settings-navigation-item active" aria-current="page" aria-label="Libraries" data-settings-panel-id="configuredLibraries">
              <span className="nav-active-pill" aria-hidden="true" />
              <span className="settings-navigation-item-content">
                <Folder className="nav-icon" aria-hidden="true" />
                {!collapsed ? <span>Libraries</span> : null}
              </span>
            </button>
            <button type="button" className="settings-navigation-item" aria-label="Connectors" data-settings-panel-id="jellyfin">
              <span className="settings-navigation-item-content">
                <Server className="nav-icon" aria-hidden="true" />
                {!collapsed ? <span>Jellyfin</span> : null}
              </span>
            </button>
          </div>
          <div className="settings-navigation-group">
            {!collapsed ? <div className="settings-navigation-group-label">Analysis</div> : null}
            <button type="button" className="settings-navigation-item" aria-label="Quality profiles" data-settings-panel-id="qualityProfiles">
              <span className="settings-navigation-item-content">
                <SlidersHorizontal className="nav-icon" aria-hidden="true" />
                {!collapsed ? <span>Quality profiles</span> : null}
              </span>
            </button>
          </div>
          <div className="settings-navigation-group">
            {!collapsed ? <div className="settings-navigation-group-label">Application</div> : null}
            <button type="button" className="settings-navigation-item" aria-label="App settings" data-settings-panel-id="appSettings">
              <span className="settings-navigation-item-content">
                <Settings className="nav-icon" aria-hidden="true" />
                {!collapsed ? <span>App settings</span> : null}
              </span>
            </button>
          </div>
          <div className="settings-navigation-group">
            {!collapsed ? <div className="settings-navigation-group-label">Maintenance &amp; Diagnostics</div> : null}
            <button type="button" className="settings-navigation-item" aria-label="Recent scan logs" data-settings-panel-id="recentScans">
              <span className="settings-navigation-item-content">
                <History className="nav-icon" aria-hidden="true" />
                {!collapsed ? <span>Recent scan logs</span> : null}
              </span>
            </button>
          </div>
        </nav>
        <div className="settings-navigation-quick-actions">
          <div className="settings-navigation-divider" />
          {!collapsed ? <div className="settings-navigation-section-label">Quick actions</div> : null}
          <button type="button" className="secondary settings-navigation-quick-action" aria-label="Full scan" title="Full scan">
            <Database className="nav-icon" aria-hidden="true" />
            {!collapsed ? <span>Full scan</span> : null}
          </button>
        </div>
      </aside>
    </div>
  );
}

function TableViewSettingsFixture() {
  const [settings, setSettings] = useState(() => buildDefaultLibraryStatisticsSettings());

  return (
    <TableViewSettingsEditor
      settings={settings}
      libraryType="movies"
      showMusicQualityScore
      hasVideoMetadata
      hasPlaybackProvider
      onChange={setSettings}
    />
  );
}

function QualityPickerFixture({ open = false }: { open?: boolean }) {
  return (
    <div className="quality-picker-field-shell search-filter-picker">
      <button type="button" className={`quality-picker-field${open ? " is-open" : ""}`}>
        <div className="quality-picker-values">
          <span className="badge quality-picker-chip">HEVC</span>
          <span className="badge quality-picker-chip">AV1</span>
        </div>
        <ChevronDown className="nav-icon" aria-hidden="true" />
      </button>
      {open ? (
        <div className="search-filter-picker-popover quality-picker-popover">
          <div className="quality-picker-custom-entry">
            <div className="quality-picker-custom-row">
              <input className="quality-picker-custom-input" defaultValue="vvc" aria-label="Custom value" />
              <button type="button" className="secondary small">
                Add
              </button>
            </div>
          </div>
          <button type="button" className="search-filter-picker-item is-selected">HEVC</button>
          <button type="button" className="search-filter-picker-item">H.264</button>
        </div>
      ) : null}
    </div>
  );
}

function QualityProfileFixture() {
  return (
    <div className="quality-profile-panel-stack">
      <div className="compatibility-profile-list quality-profile-list">
        <div className="settings-profile-toggle-row transcode-automation-toggle-row quality-profile-toggle-row">
          <div className="transcode-automation-tab-controls">
            <div className="transcode-automation-tab-list" role="tablist" aria-label="Media type" aria-orientation="horizontal">
              <button type="button" role="tab" className="transcode-automation-tab-button active" aria-selected="true" tabIndex={0}>
                <span className="transcode-automation-tab-label">Video</span>
              </button>
              <button type="button" role="tab" className="transcode-automation-tab-button" aria-selected="false" tabIndex={-1}>
                <span className="transcode-automation-tab-label">Music</span>
              </button>
              <button type="button" role="tab" className="transcode-automation-tab-button" aria-selected="false" tabIndex={-1}>
                <span className="transcode-automation-tab-label">Audiobook</span>
              </button>
            </div>
          </div>
          <div className="settings-profile-toggle-actions">
            <button type="button" className="secondary small settings-panel-header-action">
              <Plus aria-hidden="true" className="nav-icon" />
              <span>New profile</span>
            </button>
          </div>
        </div>
        <article className="compatibility-profile-list-item">
          <div className="compatibility-profile-list-row quality-profile-list-row">
            <button type="button" className="compatibility-profile-list-trigger" aria-expanded="false">
              <span className="transcode-automation-list-copy quality-profile-list-copy">
                <strong>Default video</strong>
                <small>Default · Built-in</small>
              </span>
              <ChevronDown aria-hidden="true" />
            </button>
            <div className="compatibility-profile-quick-actions quality-profile-quick-actions">
              <TooltipTrigger
                ariaLabel="Built-in default profile protection"
                className="quality-profile-protected-tooltip"
                content="Built-in default profiles are protected for app updates. Duplicate this profile or create a new one to make changes."
                align="start"
              >
                <Lock className="nav-icon" aria-hidden="true" size={16} />
              </TooltipTrigger>
              <button type="button" className="quality-profile-action-button" disabled title="Built-in default profiles are protected for app updates.">
                <Save className="nav-icon" aria-hidden="true" />
              </button>
              <button type="button" className="quality-profile-action-button" disabled title="Built-in default profiles are protected for app updates.">
                <SquarePenIcon className="nav-icon" aria-hidden="true" />
              </button>
              <button type="button" className="quality-profile-action-button" title="Duplicate profile">
                <CopyIcon className="nav-icon" aria-hidden="true" />
              </button>
              <button type="button" className="quality-profile-action-button" disabled title="Built-in default profiles are protected for app updates.">
                <DeleteIcon className="nav-icon" aria-hidden="true" />
              </button>
            </div>
          </div>
        </article>
        <article className="compatibility-profile-list-item is-expanded">
          <div className="compatibility-profile-list-row quality-profile-list-row">
            <button type="button" className="compatibility-profile-list-trigger" aria-expanded="true" aria-controls="catalog-quality-profile-details-cinema">
              <span className="transcode-automation-list-copy quality-profile-list-copy">
                <strong>Cinema</strong>
                <small>Custom</small>
              </span>
              <ChevronDown aria-hidden="true" />
            </button>
            <div className="compatibility-profile-quick-actions quality-profile-quick-actions">
              <button type="button" className="quality-profile-action-button" aria-label="Set as default" title="Set as default">
                <CheckIcon className="nav-icon" aria-hidden="true" />
              </button>
              <button type="button" className="quality-profile-action-button" aria-label="Duplicate profile" title="Duplicate profile">
                <CopyIcon className="nav-icon" aria-hidden="true" />
              </button>
              <button type="button" className="quality-profile-action-button" aria-label="Delete profile" title="Delete profile">
                <DeleteIcon className="nav-icon" aria-hidden="true" />
              </button>
            </div>
          </div>
          <div id="catalog-quality-profile-details-cinema" className="quality-profile-details">
            <div className="quality-profile-editor">
              <div className="quality-profile-add-row">
                <select className="settings-choice-input" defaultValue="" aria-label="Add metric">
                  <option value="">Add metric…</option>
                  <option value="dynamic_range">Dynamic range</option>
                  <option value="language_preferences">Language preferences</option>
                </select>
              </div>
              <div className="quality-profile-metric-list">
                <div className="quality-profile-metric-item">
                  <div className="quality-profile-metric-row">
                    <div className="quality-profile-metric-title">
                      <button type="button" className="quality-profile-metric-toggle" aria-expanded="false" aria-label="Configure Resolution metric">
                        <ChevronRight className="nav-icon" aria-hidden="true" size={16} />
                      </button>
                      <span className="quality-profile-metric-name">
                        <strong>Resolution</strong>
                        <TooltipTrigger ariaLabel="Explain Resolution metric" className="quality-profile-metric-tooltip" content="Resolution score based on the selected resolution categories." />
                        <span role="button" tabIndex={0} className="quality-profile-metric-link-button" aria-label="Edit resolution categories" title="Edit resolution categories">
                          <SquarePenIcon aria-hidden="true" className="nav-icon" size={16} />
                        </span>
                      </span>
                    </div>
                    <div className="quality-profile-weight-control">
                      <input className="quality-profile-weight-input" type="number" defaultValue={8} aria-label="Explain metric weight" />
                    </div>
                    <button type="button" className="secondary icon-only-button quality-profile-metric-remove-button" aria-label="Remove Resolution metric">
                      <Trash2 aria-hidden="true" className="nav-icon" size={18} />
                    </button>
                  </div>
                </div>
                <div className="quality-profile-metric-item is-expanded">
                  <div className="quality-profile-metric-row">
                    <div className="quality-profile-metric-title">
                      <button type="button" className="quality-profile-metric-toggle" aria-expanded="true" aria-label="Configure Visual density metric">
                        <ChevronDown className="nav-icon" aria-hidden="true" size={16} />
                      </button>
                      <span className="quality-profile-metric-name"><strong>Visual density</strong></span>
                    </div>
                    <div className="quality-profile-weight-control">
                      <input className="quality-profile-weight-input" type="number" defaultValue={10} aria-label="Explain metric weight" />
                    </div>
                    <button type="button" className="secondary icon-only-button quality-profile-metric-remove-button" aria-label="Remove Visual density metric">
                      <Trash2 aria-hidden="true" className="nav-icon" size={18} />
                    </button>
                  </div>
                  <div className="quality-profile-metric-settings">
                    <div className="quality-profile-metric-settings-grid">
                      <div className="quality-profile-boundary-field">
                        <span>Minimum</span>
                        <input className="settings-choice-input" type="number" defaultValue={1.2} aria-label="Minimum (GB/hour)" />
                      </div>
                      <div className="quality-profile-boundary-field">
                        <span>Ideal</span>
                        <input className="settings-choice-input" type="number" defaultValue={2.4} aria-label="Ideal (GB/hour)" />
                      </div>
                      <div className="quality-profile-boundary-field">
                        <span>Maximum</span>
                        <input className="settings-choice-input" type="number" defaultValue={4.8} aria-label="Maximum (GB/hour)" />
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </article>
      </div>
    </div>
  );
}

function SearchFilterFixture({ invalid = false }: { invalid?: boolean }) {
  return (
    <div className={`metadata-search-row${invalid ? " is-invalid" : ""}`}>
      <div className="metadata-search-control">
        <button type="button" className="metadata-search-icon-button" aria-label="Search field">
          <Search aria-hidden="true" className="nav-icon" />
        </button>
        <input type="search" defaultValue={invalid ? ">=4GB,<" : "codec:hevc, hdr:!sdr"} aria-label="Structured search" />
        <button type="button" className="metadata-search-remove" aria-label="Clear search">
          <X aria-hidden="true" className="nav-icon" />
        </button>
      </div>
      {invalid ? <p className="metadata-search-error">Incomplete numeric expression.</p> : null}
    </div>
  );
}

function IgnorePatternFixture() {
  return (
    <div className="ignore-pattern-section">
      <div className="ignore-pattern-section-toggle-row">
        <button type="button" className="secondary icon-only-button ignore-pattern-section-chevron" aria-label="Collapse User ignore patterns" aria-expanded="true">
          <ChevronDown aria-hidden="true" className="nav-icon" />
        </button>
        <div className="ignore-pattern-section-toggle-lead">
          <button type="button" className="secondary ignore-pattern-section-toggle ignore-pattern-section-toggle-plain" aria-expanded="true">
            <span className="ignore-pattern-section-title">User ignore patterns</span>
            <span className="sr-only">2</span>
          </button>
        </div>
        <span className="ignore-pattern-section-meta">
          <span className="badge">2</span>
        </span>
      </div>
      <div className="ignore-pattern-section-body">
        <div className="ignore-pattern-row ignore-pattern-row-draft">
          <div className="ignore-pattern-control">
            <input className="settings-choice-input" defaultValue="*.sample" aria-label="New ignore pattern" />
          </div>
          <button type="button" className="secondary icon-only-button ignore-pattern-action-button" aria-label="Add">
            <Plus aria-hidden="true" className="nav-icon" />
          </button>
        </div>
        <div className="ignore-pattern-row ignore-pattern-row-saved">
          <div className="ignore-pattern-control">
            <input className="settings-choice-input" defaultValue="*/@eaDir/*" aria-label="Saved ignore pattern" />
          </div>
          <button type="button" className="secondary icon-only-button ignore-pattern-action-button" aria-label="Remove">
            <Trash2 aria-hidden="true" className="nav-icon" />
          </button>
        </div>
      </div>
    </div>
  );
}

function StatisticLayoutFixture() {
  return (
    <div className="media-grid statistic-layout-grid is-editing">
      <div className="statistic-layout-panel-shell span-x-2 span-y-2 is-drop-target">
        <AsyncPanel title="Editable statistic panel">
          <DistributionList items={distributionItems} />
        </AsyncPanel>
        <div className="statistic-layout-overlay">
          <div className="statistic-layout-overlay-sheen" />
          <div className="statistic-layout-size-controls statistic-layout-size-controls-top-left">
            <button type="button" className="statistic-layout-size-button" aria-label="Remove">
              <Trash2 className="nav-icon" aria-hidden="true" />
            </button>
          </div>
          <div className="statistic-layout-size-controls statistic-layout-size-controls-right">
            <button type="button" className="statistic-layout-size-button" aria-label="Expand width">
              <PanelRightClose className="nav-icon" aria-hidden="true" />
            </button>
            <button type="button" className="statistic-layout-size-button" aria-label="Shrink width">
              <PanelLeftClose className="nav-icon" aria-hidden="true" />
            </button>
          </div>
          <div className="statistic-layout-size-controls statistic-layout-size-controls-bottom">
            <button type="button" className="statistic-layout-size-button" aria-label="Expand height">
              <PanelBottomClose className="nav-icon" aria-hidden="true" />
            </button>
            <button type="button" className="statistic-layout-size-button" aria-label="Shrink height">
              <PanelTopClose className="nav-icon" aria-hidden="true" />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function ScanJobFixture({ determinate = false }: { determinate?: boolean }) {
  return (
    <div className={`scan-job-card ${determinate ? "is-determinate ui-elements-determinate-scan" : "is-indeterminate"}`.trim()}>
      <div className="scan-job-card-main">
        <AnimatedSearchIcon animateOnMount className="scan-job-card-search-icon" />
        <span className="scan-job-card-name">{determinate ? "Music library" : "Movies archive"}</span>
        <div className="scan-job-metrics">
          {[
            { icon: FilePlusCorner, value: "42" },
            { icon: FileDiff, value: "18" },
            { icon: FileExclamationPoint, value: "3" },
            { icon: FileCheckCorner, value: determinate ? "82%" : "128" },
          ].map(({ icon: Icon, value }) => (
            <span key={value} className="scan-job-metric-item">
              <span className="scan-job-metric-icon-wrap">
                <Icon aria-hidden="true" size={14} />
                <span className="scan-job-metric-value">{value}</span>
              </span>
            </span>
          ))}
        </div>
        <div className="scan-job-card-actions">
          <button type="button" className="secondary icon-only-button scan-job-toggle-button" aria-label="Toggle">
            <ListFilter aria-hidden="true" className="nav-icon" />
          </button>
        </div>
      </div>
    </div>
  );
}

function ScanLogFixture() {
  return (
    <div className="scan-log-card">
      <button type="button" className="scan-log-summary">
        <div className="scan-log-summary-head">
          <div className="scan-log-summary-copy">
            <strong>Movies archive</strong>
            <span>Incremental scan - manual trigger</span>
          </div>
          <div className="meta-tags">
            <span className="badge scan-log-outcome badge-completed_with_issues">Completed with issues</span>
            <span className="scan-badge badge">incremental</span>
          </div>
        </div>
        <div className="scan-log-summary-meta">
          <span>128 analyzed</span>
          <span>3 errors</span>
          <span>42 unchanged</span>
        </div>
      </button>
      <div className="scan-log-detail">
        <div className="scan-log-detail-sections">
          <details className="scan-log-detail-section scan-log-collapsible-block" open>
            <summary className="scan-log-collapse-toggle">
              <span className="scan-log-collapse-copy">
                <strong>Failed files</strong>
                <span className="scan-log-collapse-summary">Short reasons plus copyable diagnostics</span>
              </span>
              <span className="scan-log-collapse-meta">
                <span className="badge">3</span>
                <ChevronRight aria-hidden="true" className="nav-icon scan-log-collapse-icon" />
              </span>
            </summary>
            <div className="scan-log-collapse-content">
              <div className="scan-log-pattern-card">
                <div className="scan-log-detail-title">
                  <code className="scan-log-path">Movies/Broken.mkv</code>
                  <button type="button" className="scan-log-copy-button" aria-label="Copy diagnostic">
                    <Copy className="nav-icon" aria-hidden="true" />
                  </button>
                </div>
                <p className="scan-log-failure-reason">ffprobe exited with code 1</p>
              </div>
            </div>
          </details>
        </div>
      </div>
    </div>
  );
}

function FileDetailNavigationFixture() {
  return (
    <div className="file-detail-layout settings-layout">
      <aside className="settings-navigation-panel file-detail-navigation-panel" aria-label="File detail navigation">
        <button
          type="button"
          className="settings-mobile-menu-button"
          aria-label="Open file detail navigation"
          aria-expanded="false"
          aria-controls="file-detail-mobile-navigation-menu"
        >
          <span className="settings-mobile-menu-button-content">
            <span className="settings-mobile-menu-current">
              <FileVideo className="nav-icon" aria-hidden="true" />
              <span>Overview</span>
            </span>
          </span>
          <ChevronDown aria-hidden="true" className="settings-mobile-menu-chevron" />
        </button>
        <div id="file-detail-mobile-navigation-menu" className="settings-mobile-navigation-menu" aria-hidden="true">
          <nav className="settings-mobile-navigation-list" aria-label="Mobile file detail navigation">
            <button type="button" className="settings-navigation-item settings-mobile-navigation-item active" aria-current="page" data-file-detail-panel-id="overview" data-toggle-key="overview" tabIndex={-1}>
              <span className="nav-active-pill" />
              <span className="settings-navigation-item-content">
                <FileVideo className="nav-icon" aria-hidden="true" />
                <span>Overview</span>
              </span>
            </button>
            <button type="button" className="settings-navigation-item settings-mobile-navigation-item" data-file-detail-panel-id="streams" data-toggle-key="streams" tabIndex={-1}>
              <span className="settings-navigation-item-content">
                <Database className="nav-icon" aria-hidden="true" />
                <span>Streams</span>
              </span>
            </button>
          </nav>
        </div>
        <div className="settings-navigation-quick-actions file-detail-navigation-actions">
          <button type="button" className="secondary small settings-panel-header-action file-detail-navigation-back-button" aria-label="Back" title="Back">
            <ArrowLeft className="nav-icon" aria-hidden="true" />
            <span>Back</span>
          </button>
        </div>
        <div className="settings-navigation-header">
          <span>File details</span>
          <button type="button" className="secondary icon-only-button settings-navigation-collapse-button" aria-label="Collapse file detail navigation" aria-expanded="true">
            <PanelLeftToggleIcon aria-hidden="true" collapsed={false} className="settings-navigation-toggle-icon" size={24} />
          </button>
        </div>
        <nav className="settings-navigation-list">
          <button type="button" className="settings-navigation-item active" aria-current="page" aria-label="Overview" data-file-detail-panel-id="overview" data-toggle-key="overview">
            <span className="nav-active-pill" />
            <span className="settings-navigation-item-content">
              <FileVideo className="nav-icon" aria-hidden="true" />
              <span>Overview</span>
            </span>
          </button>
          <button type="button" className="settings-navigation-item" aria-label="Streams" data-file-detail-panel-id="streams" data-toggle-key="streams">
            <span className="settings-navigation-item-content">
              <Database className="nav-icon" aria-hidden="true" />
              <span>Streams</span>
            </span>
          </button>
        </nav>
      </aside>
      <section className="panel file-detail-active-panel">
        <div className="file-detail-title-row">
          <h2 className="file-detail-title">Arrival.2016.UHD.mkv</h2>
          <TooltipTrigger ariaLabel="Show path" content="/media/Movies/Arrival.2016.UHD.mkv">
            <Info aria-hidden="true" className="nav-icon" />
          </TooltipTrigger>
        </div>
        <div className="file-detail-overview">
          <div className="meta-tags">
            <button type="button" className="file-detail-badge-tooltip-trigger tooltip-trigger">
              <span className="badge">HEVC</span>
            </button>
            <span className="badge">3840x2160</span>
            <span className="badge">HDR10</span>
          </div>
        </div>
      </section>
    </div>
  );
}

function PreviewFixture() {
  return (
    <div className="file-detail-preview-panel">
      <div className="file-detail-preview-player-shell">
        <video className="file-detail-preview-player" controls aria-label="Preview player" />
      </div>
      <div className="file-detail-preview-report">
        <p>Browser playback is a best-effort preview and may not support every codec.</p>
        <button type="button" className="file-detail-preview-report-button file-detail-cover-button secondary small">
          <Download className="nav-icon" aria-hidden="true" />
          Download file
        </button>
      </div>
    </div>
  );
}

function DuplicateGroupFixture({ suppressed = false }: { suppressed?: boolean }) {
  return (
    <div className={`duplicate-group-card${suppressed ? " is-suppressed" : ""}`}>
      <div className="duplicate-group-summary">
        <div className="duplicate-group-summary-main">
          <button type="button" className="duplicate-group-badge-tooltip-trigger tooltip-trigger">
            <span className="badge">{suppressed ? "Suppressed" : "Filename"}</span>
          </button>
          <strong>arrival 2016</strong>
        </div>
        <button type="button" className="secondary icon-only-button duplicate-group-action duplicate-group-compare-action" aria-label="Compare files">
          <GitCompareArrowsIcon className="duplicate-group-action-icon" size={17} />
        </button>
        <button type="button" className="secondary icon-only-button duplicate-group-action" aria-label="Hide group">
          {suppressed ? <Eye className="duplicate-group-action-icon is-suppressed" /> : <EyeOff className="duplicate-group-action-icon" />}
        </button>
      </div>
      <div className="duplicate-group-items-scroll">
        <div className="duplicate-group-item-card">
          <span className="duplicate-group-item-name">Movies 4K / Arrival.2016.mkv</span>
          <span className="duplicate-group-item-size">18.4 GB</span>
          <button type="button" className="secondary icon-only-button duplicate-group-open-button" aria-label="Open file">
            <ArrowUpRight className="duplicate-group-open-icon" aria-hidden="true" />
          </button>
        </div>
      </div>
    </div>
  );
}

function PathBrowserFixture() {
  const [value, setValue] = useState(".");
  const [selectedPaths, setSelectedPaths] = useState(["Movies", "Archive/Anime"]);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const originalBrowse = api.browse;
    api.browse = async (path = ".") => mockBrowseResponses[path] ?? mockBrowseResponses["."];
    setReady(true);
    return () => {
      api.browse = originalBrowse;
    };
  }, []);

  if (!ready) {
    return <div className="notice">Loading path browser...</div>;
  }

  return (
    <PathBrowser
      value={value}
      selectedPaths={selectedPaths}
      onChange={setValue}
      onAddPath={(path) => setSelectedPaths((current) => (current.includes(path) ? current : [...current, path]))}
      onRemovePath={(path) => setSelectedPaths((current) => current.filter((item) => item !== path))}
    />
  );
}

function MissingPathBrowserFixture() {
  const [value, setValue] = useState("MissingMovies");
  const [selectedPaths, setSelectedPaths] = useState(["MissingMovies"]);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const originalBrowse = api.browse;
    api.browse = async (path = ".") => {
      if (path === "MissingMovies") {
        throw new Error("Folder not found");
      }
      return mockBrowseResponses[path] ?? mockBrowseResponses["."];
    };
    setReady(true);
    return () => {
      api.browse = originalBrowse;
    };
  }, []);

  if (!ready) {
    return <div className="notice">Loading path browser...</div>;
  }

  return (
    <PathBrowser
      value={value}
      selectedPaths={selectedPaths}
      onChange={setValue}
      onAddPath={(path) => setSelectedPaths((current) => (current.includes(path) ? current : [...current, path]))}
      onRemovePath={(path) => setSelectedPaths((current) => current.filter((item) => item !== path))}
    />
  );
}

function ComparisonChartFixture() {
  const [selection, setSelection] = useState<ComparisonSelection>({
    xField: "duration",
    yField: "size",
    renderer: "heatmap",
  });

  return (
    <ComparisonChartPanel
      comparison={comparisonResponse}
      selection={selection}
      onChangeXField={(xField) => setSelection((current) => ({ ...current, xField }))}
      onChangeYField={(yField) => setSelection((current) => ({ ...current, yField }))}
      onSwapAxes={() => setSelection((current) => ({ ...current, xField: current.yField, yField: current.xField }))}
      onChangeRenderer={(renderer) => setSelection((current) => ({ ...current, renderer }))}
    />
  );
}

function ReleaseDialogFixture() {
  return (
    <div className="release-notes-dialog ui-elements-dialog-surface" role="presentation">
      <div className="release-notes-header release-notes-header-menu-open">
        <div className="release-notes-title-block">
          <h2>Release history</h2>
        </div>
        <div className="release-notes-actions">
          <button type="button" className="release-notes-download release-notes-download-success">
            <Download className="nav-icon" aria-hidden="true" />
            <span>Downloaded</span>
          </button>
          <TelemetryModeToggle compact mode="minimal" onChange={() => undefined} />
          <a href="/releases" className="release-notes-icon-link" aria-label="Open GitHub repository" onClick={preventCatalogNavigation}>
            <GithubIcon className="release-notes-github-icon" size={18} aria-hidden="true" />
          </a>
          <button type="button" className="release-notes-close" aria-label="Close">
            <X aria-hidden="true" className="nav-icon" />
          </button>
        </div>
      </div>
      <div className="alert release-notes-alert">
        The installer for this system has not been published yet.{" "}
        <a href="/releases/tag/v0.18.0" onClick={preventCatalogNavigation}>Open the release page</a>
      </div>
      <div className="release-notes-content">
        <section className="release-notes-version release-notes-version-current">
          <button type="button" className="release-notes-version-toggle">
            <span className="release-notes-version-title">
              vdev
              <span className="release-notes-current-badge">Currently installed</span>
            </span>
            <span className="release-notes-version-meta">
              <ChevronDown aria-hidden="true" className="nav-icon" />
            </span>
          </button>
          <div className="release-notes-version-body">
            <section className="release-notes-section">
              <h3>New</h3>
              <ul>
                <li>
                  Example release note with <a href="https://github.com/frederikemmer/MediaLyze/issues/153" onClick={preventCatalogNavigation}>#153</a>.
                </li>
              </ul>
            </section>
          </div>
        </section>
      </div>
    </div>
  );
}

export function UiElementsPage() {
  const { t } = useTranslation();
  const { preference: themePreference, setPreference: setThemePreference } = useTheme();
  const [collapsed, setCollapsed] = useState(false);
  const [audioPrimaryMode, setAudioPrimaryMode] = useState<AudioStreamPrimaryMode>("quality");
  const source = t("uiElements.source");
  const settings = t("uiElements.sources.settings");
  const dashboard = t("uiElements.sources.dashboard");
  const libraryDetail = t("uiElements.sources.libraryDetail");
  const fileDetail = t("uiElements.sources.fileDetail");
  const scanLogs = t("uiElements.sources.scanLogs");
  const releaseNotes = t("uiElements.sources.releaseNotes");
  const header = t("uiElements.sources.header");

  const sectionLinks = useMemo(
    () => catalogSections.map((section) => ({ ...section, title: t(section.titleKey) })),
    [t],
  );

  function updateThemePreview(nextTheme: ThemePreference) {
    setThemePreference(nextTheme);
  }

  return (
    <main className="ui-elements-page">
      <section className="panel ui-elements-hero">
        <div>
          <p className="eyebrow">{t("uiElements.eyebrow")}</p>
          <h2>{t("uiElements.title")}</h2>
          <p className="subtitle">{t("uiElements.subtitle")}</p>
        </div>
        <div className="ui-elements-hero-actions">
          <span className="badge scan-badge">{t("uiElements.devOnly")}</span>
          <label className="field ui-elements-theme-field">
            <span>{t("uiElements.themePreview")}</span>
            <select className="settings-choice-input" value={themePreference} onChange={(event) => updateThemePreview(event.target.value as ThemePreference)}>
              <option value="system">{t("theme.system")}</option>
              <option value="light">{t("theme.light")}</option>
              <option value="dark">{t("theme.dark")}</option>
            </select>
          </label>
          <button type="button" className="secondary small">
            <Download aria-hidden="true" className="nav-icon" />
            {t("uiElements.sampleAction")}
          </button>
        </div>
      </section>

      <div className="ui-elements-layout">
        <nav className="panel ui-elements-index" aria-label={t("uiElements.indexAria")}>
          <strong>{t("uiElements.indexTitle")}</strong>
          {sectionLinks.map((section) => (
            <a key={section.id} href={`#${section.id}`}>
              {section.title}
            </a>
          ))}
        </nav>

        <div className="ui-elements-content">
          <CatalogSection definition={catalogSections[0]}>
            <VariantGroup title="Tokens and type">
              <VariantCard title="Theme tokens" source={`${source}: globals.css`} classes={["--bg", "--panel", "--surface", "--surface-subtle", "--border", "--scrollbar-thumb", "--scrollbar-thumb-hover", "--accent", "--accent-2"]} wide>
                <div className="ui-elements-token-grid">
                  {colorTokens.map((token) => (
                    <article key={token.name} className="ui-elements-token">
                      <span className="ui-elements-token-swatch" style={{ background: token.value }} />
                      <strong>{token.name}</strong>
                      <span>{token.value}</span>
                    </article>
                  ))}
                </div>
              </VariantCard>
              <VariantCard title="Typography stack" source={`${source}: global app shell`} classes={["eyebrow", "subtitle", "panel-title-row"]}>
                <div className="stack">
                  <p className="eyebrow">Eyebrow</p>
                  <h1>MediaLyze</h1>
                  <h2>Panel heading</h2>
                  <h3>Compact heading</h3>
                  <p className="subtitle">Muted helper copy used in panels and settings.</p>
                </div>
              </VariantCard>
            </VariantGroup>
          </CatalogSection>

          <CatalogSection definition={catalogSections[1]}>
            <VariantGroup title="Header variants">
              <VariantCard title="Primary and library nav" source={header} classes={["media-nav-panel", "media-nav-icons", "media-nav-libraries", "library-nav-link", "icon-nav-button", "nav-active-pill"]}>
                <div className="media-nav-panel">
                  <div className="media-nav-icons">
                    <a href="/" className="icon-nav-button active" aria-label="Dashboard" onClick={preventCatalogNavigation}>
                      <span className="nav-active-pill" />
                      <span className="nav-link-content">
                        <House aria-hidden="true" className="nav-icon" />
                      </span>
                    </a>
                    <a href="/files/compare" className="icon-nav-button" aria-label="Compare files" onClick={preventCatalogNavigation}>
                      <span className="nav-link-content">
                        <GitCompare aria-hidden="true" className="nav-icon" />
                      </span>
                    </a>
                    <a href="/settings" className="icon-nav-button is-first-library-attention" aria-label="Settings" onClick={preventCatalogNavigation}>
                      <span className="nav-link-content">
                        <Settings aria-hidden="true" className="nav-icon" />
                      </span>
                    </a>
                    <a href="/storage-map" className="icon-nav-button" aria-label="Storage map" onClick={preventCatalogNavigation}>
                      <span className="nav-link-content">
                        <Map aria-hidden="true" className="nav-icon" />
                      </span>
                    </a>
                  </div>
                  <div className="media-nav-libraries ui-elements-library-nav">
                    <a href="/libraries/1" className="library-nav-link active" onClick={preventCatalogNavigation}>
                      <span className="nav-active-pill" />
                      <span className="nav-link-content">Movies</span>
                    </a>
                    <a href="/libraries/2" className="library-nav-link" onClick={preventCatalogNavigation}>
                      <span className="nav-link-content">Music</span>
                    </a>
                  </div>
                </div>
              </VariantCard>
              <VariantCard title="Brand, version, and update labels" source={header} classes={["app-title-link", "app-version", "app-version-update"]} status="The header version pill stays compact and 30% smaller beside the MediaLyze title.">
                <div className="app-title-block">
                  <a href="/" className="app-title-link" aria-label="Dashboard" onClick={preventCatalogNavigation}>
                    <h1>MediaLyze</h1>
                  </a>
                  <button type="button" className="app-version">dev</button>
                  <span className="app-version-update">Update available: v0.15.0</span>
                </div>
              </VariantCard>
            </VariantGroup>
          </CatalogSection>

          <CatalogSection definition={catalogSections[2]}>
            <VariantGroup title="Navigation and settings controls">
              <VariantCard title="Settings sidebar" source={`${settings} > Navigation`} classes={["settings-navigation-panel", "settings-navigation-item", "settings-navigation-quick-action", "settings-navigation-search-stack", "settings-mobile-navigation-search-stack", "settings-mobile-navigation-search", "settings-search-results", "settings-search-result", "settings-search-result-label", "settings-search-result-context"]} wide>
                <SettingsNavigationFixture />
              </VariantCard>
              <VariantCard title="Settings sidebar · no search match" source={`${settings} > Navigation > Search empty`} classes={["settings-navigation-panel", "settings-navigation-search-stack", "settings-search-results", "settings-search-result-empty"]} wide>
                <SettingsNavigationFixture noResults />
              </VariantCard>
              <VariantCard title="Compatibility profile list" source={`${settings} > Hard/Software Profiles`} classes={["compatibility-profile-list", "compatibility-profile-search", "compatibility-profile-list-item", "compatibility-profile-list-row", "quality-profile-list-row", "compatibility-profile-list-trigger", "compatibility-profile-quick-actions", "transcode-automation-list-copy", "compatibility-profile-list-copy", "compatibility-profile-details", "settings-choice-input"]} wide>
                <div className="compatibility-profile-list">
                  <div className="compatibility-profile-search">
                    <Search size={16} aria-hidden="true" className="compatibility-profile-search-icon" />
                    <input type="search" placeholder="Search profiles" aria-label="Search hardware profiles" />
                  </div>
                  <article className="compatibility-profile-list-item">
                    <div className="compatibility-profile-list-row quality-profile-list-row">
                      <button type="button" className="compatibility-profile-list-trigger">
                        <span className="transcode-automation-list-copy compatibility-profile-list-copy"><strong>Apple TV 4K 3rd Gen</strong></span>
                        <ChevronDown aria-hidden="true" />
                      </button>
                      <div className="compatibility-profile-quick-actions">
                        <button type="button" className="secondary icon-only-button compatibility-profile-quick-action is-favorite" aria-label="Remove Apple TV profile from favorites" aria-pressed="true">
                          <AnimatedSparklesIcon size={18} aria-hidden="true" className="nav-icon" />
                        </button>
                        <button type="button" className="secondary icon-only-button compatibility-profile-quick-action" aria-label="Edit Apple TV profile">
                          <SquarePenIcon size={18} aria-hidden="true" className="nav-icon" />
                        </button>
                        <button type="button" className="secondary icon-only-button compatibility-profile-quick-action" aria-label="Clone Apple TV profile">
                          <CopyIcon size={18} aria-hidden="true" className="nav-icon" />
                        </button>
                        <button type="button" className="secondary icon-only-button compatibility-profile-quick-action" aria-label="Delete Apple TV profile" disabled>
                          <DeleteIcon size={18} aria-hidden="true" className="nav-icon" />
                        </button>
                      </div>
                    </div>
                  </article>
                  <article className="compatibility-profile-list-item is-expanded">
                    <div className="compatibility-profile-list-row quality-profile-list-row">
                      <button type="button" className="compatibility-profile-list-trigger" aria-expanded="true">
                        <span className="transcode-automation-list-copy compatibility-profile-list-copy"><strong>VLC 3 Desktop</strong></span>
                        <ChevronDown aria-hidden="true" />
                      </button>
                      <div className="compatibility-profile-quick-actions">
                        <button type="button" className="secondary icon-only-button compatibility-profile-quick-action" aria-label="Add VLC profile to favorites" aria-pressed="false">
                          <AnimatedSparklesIcon size={18} aria-hidden="true" className="nav-icon" />
                        </button>
                        <button type="button" className="secondary icon-only-button compatibility-profile-quick-action" aria-label="Edit VLC profile">
                          <SquarePenIcon size={18} aria-hidden="true" className="nav-icon" />
                        </button>
                        <button type="button" className="secondary icon-only-button compatibility-profile-quick-action" aria-label="Clone VLC profile">
                          <CopyIcon size={18} aria-hidden="true" className="nav-icon" />
                        </button>
                        <button type="button" className="secondary icon-only-button compatibility-profile-quick-action" aria-label="Delete VLC profile">
                          <DeleteIcon size={18} aria-hidden="true" className="nav-icon" />
                        </button>
                      </div>
                    </div>
                    <div className="compatibility-profile-details">
                      <div className="compatibility-profile-form-grid">
                        <label>Name<input className="settings-choice-input" readOnly value="VLC 3 Desktop" /></label>
                        <label>
                          Category
                          <select className="settings-choice-input" disabled defaultValue="player">
                            <option value="player">Media player</option>
                            <option value="other">Other</option>
                          </select>
                        </label>
                        <label>Developer<input className="settings-choice-input" readOnly value="VideoLAN" /></label>
                        <label>Verified by<select className="settings-choice-input" disabled defaultValue="project-documentation"><option value="project-documentation">Project documentation</option></select></label>
                      </div>
                    </div>
                  </article>
                </div>
              </VariantCard>
              <VariantCard title="Structured compatibility capability editor" source={`${settings} > Hard/Software Profiles > Profile details`} classes={["compatibility-capability-section", "compatibility-capability-row", "compatibility-capability-limits", "settings-choice-input"]} status="Nested surfaces follow the active theme without light gray fallbacks." wide>
                <details className="compatibility-capability-section" open>
                  <summary>Sources</summary>
                  <div className="compatibility-capability-section-body">
                    <div className="compatibility-capability-editor">
                      <div className="compatibility-capability-row compatibility-source-row">
                        <label>Label<input className="settings-choice-input" defaultValue="Technical specifications" /></label>
                        <label>
                          URL
                          <span className="compatibility-source-url-control is-readonly">
                            <input className="settings-choice-input" type="url" readOnly value="https://example.com/specifications" />
                            <button type="button" className="secondary icon-only-button compatibility-source-open-button" aria-label="Open source in a new tab">
                              <SquareArrowOutUpRight size={17} aria-hidden="true" />
                            </button>
                          </span>
                        </label>
                      </div>
                    </div>
                  </div>
                </details>
                <details className="compatibility-capability-section" open>
                  <summary>Audio capabilities</summary>
                  <div className="compatibility-capability-section-body">
                    <div className="compatibility-capability-editor">
                      <div className="compatibility-capability-row">
                        <label>
                          Format
                          <select className="settings-choice-input" defaultValue="truehd">
                            <option value="aac">AAC (aac)</option>
                            <option value="eac3">Dolby Digital Plus / E-AC-3 (eac3)</option>
                            <option value="truehd">Dolby TrueHD (truehd)</option>
                            <option value="dts_hd">DTS-HD (dts_hd)</option>
                            <option value="flac">FLAC (flac)</option>
                          </select>
                        </label>
                        <label>
                          Support
                          <select className="settings-choice-input" defaultValue="passthrough_only">
                            <option value="true">Supported</option>
                            <option value="limited">Limited</option>
                            <option value="passthrough_only">Passthrough only</option>
                            <option value="false">Unsupported</option>
                          </select>
                        </label>
                        <button type="button" className="secondary icon-only-button compatibility-capability-remove" aria-label="Remove TrueHD">
                          <DeleteIcon size={18} aria-hidden="true" className="nav-icon" />
                        </button>
                      </div>
                    </div>
                  </div>
                </details>
                <div className="compatibility-video-capability">
                  <div className="compatibility-capability-row">
                    <label>
                      Codec
                      <select className="settings-choice-input" defaultValue="hevc">
                        <option value="h264">H.264 / AVC (h264)</option>
                        <option value="hevc">H.265 / HEVC (hevc)</option>
                        <option value="vvc">H.266 / VVC (vvc)</option>
                        <option value="av1">AV1 (av1)</option>
                        <option value="prores">Apple ProRes (prores)</option>
                      </select>
                    </label>
                    <label className="compatibility-hardware-decode-toggle">
                      <span>Hardware decode</span>
                      <span className="compatibility-checkbox-field">
                        <input type="checkbox" defaultChecked />
                      </span>
                    </label>
                  </div>
                  <div className="compatibility-capability-limits">
                    <label>Max. resolution<input className="settings-choice-input" placeholder="e.g. 4K" /></label>
                    <label>Max. FPS<input className="settings-choice-input" placeholder="e.g. 60" /></label>
                    <label>Bit depth<input className="settings-choice-input" placeholder="e.g. 8, 10" /></label>
                    <label>HDR formats<input className="settings-choice-input" placeholder="e.g. HDR10, Dolby Vision" /></label>
                  </div>
                </div>
                <div className="compatibility-capability-row compatibility-container-row">
                  <label>
                    Container
                    <select className="settings-choice-input" defaultValue="mkv">
                      <option value="mp4">MP4 / ISO Base Media (mp4)</option>
                      <option value="mkv">Matroska Video (mkv)</option>
                      <option value="webm">WebM (webm)</option>
                      <option value="m2ts">Blu-ray MPEG-2 Transport Stream (m2ts)</option>
                      <option value="mxf">Material Exchange Format (mxf)</option>
                    </select>
                  </label>
                </div>
                <div className="compatibility-capability-row">
                  <label>
                    Subtitle format
                    <select className="settings-choice-input" defaultValue="subrip">
                      <option value="subrip">SubRip / SRT (subrip)</option>
                      <option value="ass">Advanced SubStation Alpha (ass)</option>
                      <option value="webvtt">WebVTT (webvtt)</option>
                      <option value="hdmv_pgs_subtitle">Blu-ray PGS (hdmv_pgs_subtitle)</option>
                      <option value="dvd_subtitle">DVD VobSub (dvd_subtitle)</option>
                    </select>
                  </label>
                </div>
                <div className="compatibility-video-capability">
                  <div className="compatibility-capability-row">
                    <label>Codec<select className="settings-choice-input" defaultValue="hevc"><option value="hevc">H.265 / HEVC (hevc)</option></select></label>
                    <label>
                      Playback mode
                      <select className="settings-choice-input" defaultValue="conditional">
                        <option value="direct">Direct</option>
                        <option value="direct_stream">Direct stream / remux</option>
                        <option value="video_transcode">Video transcode</option>
                        <option value="conditional">Conditional</option>
                      </select>
                    </label>
                  </div>
                  <label className="compatibility-profile-reason">
                    Conditions (JSON)
                    <textarea className="settings-choice-input" readOnly rows={3} value={'[{"kind":"device_capability","value":"HEVC decoder"}]'} />
                  </label>
                </div>
                <details className="compatibility-capability-section" open>
                  <summary>Combined compatibility rules</summary>
                  <div className="compatibility-capability-section-body">
                    <textarea className="compatibility-profile-json-editor" readOnly rows={4} value={'[{"id":"hevc-mkv-remux","match":{"containers":["mkv"],"video_codecs":["hevc"]},"mode":"direct_stream"}]'} />
                  </div>
                </details>
              </VariantCard>
              <VariantCard title="Compact combination profile tabs" source={`${settings} > Hard/Software Profiles`} classes={["panel-title-row", "tooltip-trigger", "compatibility-profile-list", "compatibility-profile-catalog-list", "settings-profile-toggle-row", "transcode-automation-toggle-row", "transcode-automation-tab-controls", "transcode-automation-tab-list", "transcode-automation-tab-button", "transcode-automation-tab-label", "settings-profile-toggle-actions", "settings-panel-header-action", "compatibility-profile-header-action"]} wide>
                <div className="compatibility-profile-list compatibility-profile-catalog-list">
                  <div className="panel-title-row">
                    <h2>Hardware &amp; software profiles</h2>
                    <TooltipTrigger
                      ariaLabel="Explain the compatibility profile catalog status"
                      content="This is a very early version of the profile catalog and it still needs to grow. MediaLyze improves through community contributions, so please suggest your own profiles, additions, and corrections."
                    >
                      ?
                    </TooltipTrigger>
                  </div>
                  <div className="settings-profile-toggle-row transcode-automation-toggle-row">
                    <div className="transcode-automation-tab-controls">
                      <div className="transcode-automation-tab-list" role="tablist" aria-label="Hardware & software profiles" aria-orientation="horizontal">
                      {(["hardware", "software", "compatibility"] as const).map((profileTab) => (
                        <button
                          key={profileTab}
                          type="button"
                          id={`catalog-compatibility-profile-tab-${profileTab}`}
                          role="tab"
                          data-toggle-key={profileTab}
                          className={`transcode-automation-tab-button${profileTab === "hardware" ? " active" : ""}`}
                          aria-selected={profileTab === "hardware"}
                          tabIndex={profileTab === "hardware" ? 0 : -1}
                        >
                          <span className="transcode-automation-tab-label">
                            {profileTab === "hardware"
                              ? "Hardware"
                              : profileTab === "software"
                                ? "Software / Player"
                                : "Combination"}
                          </span>
                        </button>
                      ))}
                      </div>
                    </div>
                    <div className="settings-profile-toggle-actions">
                      <button type="button" className="secondary small settings-panel-header-action compatibility-profile-header-action">
                        <Plus aria-hidden="true" size={16} />
                        <span>Profile</span>
                      </button>
                    </div>
                  </div>
                  <div className="compatibility-profile-search">
                    <Search size={16} aria-hidden="true" className="compatibility-profile-search-icon" />
                    <input type="search" placeholder="Search profiles" aria-label="Search Hardware profiles" />
                  </div>
                  <article className="compatibility-profile-list-item">
                    <div className="compatibility-profile-list-row quality-profile-list-row">
                      <button type="button" className="compatibility-profile-list-trigger" aria-expanded="false">
                        <span className="transcode-automation-list-copy compatibility-profile-list-copy"><strong>Apple TV 4K 3rd Gen</strong></span>
                        <ChevronDown aria-hidden="true" />
                      </button>
                      <div className="compatibility-profile-quick-actions">
                        <button type="button" className="secondary icon-only-button compatibility-profile-quick-action" aria-label="Add Apple TV profile to favorites">
                          <AnimatedSparklesIcon size={18} aria-hidden="true" className="nav-icon" />
                        </button>
                      </div>
                    </div>
                  </article>
                </div>
              </VariantCard>
              <VariantCard title="Library title actions" source={`${settings} > Libraries`} classes={["library-title-actions", "library-action-tooltip-trigger", "library-change-path-button", "settings-panel-header-action"]}>
                <div className="library-title-actions">
                  <button type="button" className="secondary icon-only-button library-action-tooltip-trigger" aria-label="Show library on dashboard">
                    <DashboardVisibilityIcon visible />
                  </button>
                  <button type="button" className="secondary icon-only-button library-action-tooltip-trigger" aria-label="Rename library">
                    <SquarePenIcon aria-hidden="true" className="nav-icon" />
                  </button>
                  <button type="button" className="secondary icon-only-button library-action-tooltip-trigger" aria-label="Delete library">
                    <DeleteIcon size={20} aria-hidden="true" className="nav-icon" />
                  </button>
                  <button type="button" className="secondary small settings-panel-header-action library-change-path-button">
                    Change path
                  </button>
                </div>
              </VariantCard>
              <VariantCard title="Library connector status action" source={`${settings} > Libraries`} classes={["connector-library-status-row", "settings-panel-header-action", "connector-action-button"]} wide>
                <div className="connector-library-status-row">
                  <div><strong>Jellyfin</strong><span>jellyfin · Movies</span></div>
                  <span className="badge">derived</span>
                  <a href="#connector" className="secondary small settings-panel-header-action connector-action-button" onClick={preventCatalogNavigation}>
                    Open connector
                    <SquareArrowOutUpRight aria-hidden="true" size={16} />
                  </a>
                </div>
              </VariantCard>
              <VariantCard title="History reconstruction action" source={`${settings} > History retention`} classes={["settings-panel-header-action", "history-retention-reconstruct-button"]}>
                <button type="button" className="secondary small settings-panel-header-action history-retention-reconstruct-button">
                  Reconstruct history
                </button>
              </VariantCard>
              <VariantCard title="Pattern recognition actions" source={`${settings} > Pattern recognition`} classes={["panel-header", "panel-title-row", "async-panel-header-status", "pattern-recognition-doc-button", "pattern-recognition-restore-button", "ignore-pattern-section-toggle-row", "ignore-pattern-section-header-action"]} wide>
                <div className="panel-header">
                  <div>
                    <div className="panel-title-row">
                      <h2>Folder &amp; pattern recognition</h2>
                      <TooltipTrigger
                        ariaLabel="Explain folder and pattern recognition"
                        content={"Configure scan-time series, bonus, and duplicate filename patterns plus ignored paths.\nPattern examples and matching rules are documented separately."}
                        preserveLineBreaks
                      >
                        ?
                      </TooltipTrigger>
                    </div>
                  </div>
                  <div className="async-panel-header-status">
                    <a href="#pattern-docs" target="_blank" rel="noreferrer" className="secondary small settings-panel-header-action pattern-recognition-doc-button">
                      Open pattern docs
                      <SquareArrowOutUpRight aria-hidden="true" size={16} />
                    </a>
                  </div>
                </div>
              </VariantCard>
              <VariantCard title="Pattern recognition mode spacing" source={`${settings} > Pattern recognition`} classes={["pattern-recognition-settings-grid", "pattern-recognition-mode-field", "settings-choice-input"]}>
                <div className="pattern-recognition-settings-grid">
                  <div className="field pattern-recognition-mode-field">
                    <label><span>Recognition mode</span><select className="settings-choice-input" defaultValue="folder-depth"><option value="folder-depth">Folder depth</option></select></label>
                  </div>
                  <div className="field">
                    <label><span>Series folder depth</span><select className="settings-choice-input" defaultValue="1"><option value="1">1</option></select></label>
                  </div>
                  <div className="field">
                    <label><span>Season folder depth</span><select className="settings-choice-input" defaultValue="2"><option value="2">2</option></select></label>
                  </div>
                </div>
              </VariantCard>
              <VariantCard title="Duplicate filename matching settings" source={`${settings} > Pattern recognition`} classes={["distribution-copy", "pattern-recognition-field-label-row", "pattern-recognition-restore-button", "app-settings-divider", "pattern-recognition-section-divider", "ignore-pattern-section", "pattern-recognition-section", "ignore-pattern-section-toggle-row", "ignore-pattern-section-toggle-lead", "ignore-pattern-section-toggle", "ignore-pattern-section-meta", "ignore-pattern-section-title", "ignore-pattern-section-chevron"]} wide>
                <div className="field">
                  <div className="distribution-copy">
                    <div className="field-label-row">
                      <strong>Duplicate filename matching</strong>
                      <TooltipTrigger
                        ariaLabel="Explain duplicate filename matching"
                        content="Filename duplicates use a cleaned title core. Trailing years and square-bracketed release metadata are ignored; every file in a group must have a known runtime within the configured tolerance."
                        preserveLineBreaks
                      >
                        ?
                      </TooltipTrigger>
                    </div>
                  </div>
                  <div className="inline-form-grid">
                    <div className="field">
                      <div className="field-label-row pattern-recognition-field-label-row">
                        <label htmlFor="ui-pattern-duration-tolerance">Maximum runtime difference (seconds)</label>
                        <TooltipTrigger
                          ariaLabel="Explain maximum runtime difference"
                          content="10 seconds is the default. Set 0 for equal runtimes only. Changes to suffix regexes require a new scan."
                          preserveLineBreaks
                        >
                          ?
                        </TooltipTrigger>
                      </div>
                      <input id="ui-pattern-duration-tolerance" className="settings-choice-input" type="number" min={0} max={300} defaultValue={10} />
                    </div>
                  </div>
                  <div className="ignore-pattern-section pattern-recognition-section">
                    <div className="ignore-pattern-section-toggle-row">
                      <button type="button" className="secondary icon-only-button ignore-pattern-section-chevron" aria-label="Collapse Filename suffix regexes" aria-expanded="true">
                        <ChevronDown aria-hidden="true" className="nav-icon" />
                      </button>
                      <div className="ignore-pattern-section-toggle-lead">
                        <button type="button" className="secondary ignore-pattern-section-toggle ignore-pattern-section-toggle-plain" aria-expanded="true">
                          <span className="ignore-pattern-section-title">Filename suffix regexes</span>
                          <span className="sr-only">1</span>
                        </button>
                      </div>
                      <span className="ignore-pattern-section-meta"><span className="badge">1</span></span>
                      <div className="ignore-pattern-section-header-action">
                        <TooltipTrigger
                          ariaLabel="Restore duplicate matching defaults"
                          content="Restore duplicate matching defaults"
                          className="secondary icon-only-button pattern-recognition-restore-button"
                          pinOnClick={false}
                        >
                          <History aria-hidden="true" className="nav-icon" size={16} />
                        </TooltipTrigger>
                      </div>
                    </div>
                  </div>
                </div>
                <div className="app-settings-divider pattern-recognition-section-divider" aria-hidden="true" />
                <div className="field">
                  <div className="field-label-row">
                    <strong>Show &amp; Seasons</strong>
                  </div>
                </div>
              </VariantCard>
              <VariantCard title="Compatibility profile actions" source={`${settings} > Hard/Software Profiles`} classes={["compatibility-profile-action-button", "settings-panel-header-action", "transcode-action-button"]}>
                <div className="compatibility-profile-card-actions">
                  <button type="button" className="secondary small settings-panel-header-action compatibility-profile-action-button">
                    <Copy aria-hidden="true" size={16} />
                    Edit local copy
                  </button>
                  <button type="button" className="transcode-action-button compatibility-profile-action-button">
                    <Save aria-hidden="true" size={16} />
                    Save
                  </button>
                </div>
              </VariantCard>
              <VariantCard title="Collapsed settings sidebar" source={`${settings} > Navigation`} classes={["is-settings-nav-collapsed", "settings-navigation-item-content"]}>
                <SettingsNavigationFixture collapsed />
              </VariantCard>
              <VariantCard title="Native settings select · persistent single chevron" source={`${settings} > Libraries / Quality profiles`} classes={["settings-choice-input"]} status="Theme-aware native popup surfaces keep option text readable in light and dark mode.">
                <div className="settings-main-column">
                  <div className="field">
                    <select className="settings-choice-input" defaultValue="system" aria-label="Theme">
                      <option value="system">System</option>
                      <option value="light">Light</option>
                      <option value="dark">Dark</option>
                    </select>
                  </div>
                </div>
              </VariantCard>
              <VariantCard title="Table view editor" source={`${settings} > Table View`} classes={["settings-data-table", "statistics-drag-handle", "settings-checkbox-cell"]} wide>
                <TableViewSettingsFixture />
              </VariantCard>
              <VariantCard title="Connector panel title action" source={`${settings} > Connectors`} classes={["async-panel", "panel-title-row", "settings-panel-header-action", "connector-action-button"]} wide>
                <div className="settings-main-column">
                  <AsyncPanel title="Connectors" subtitle="Connect MediaLyze to one or more media servers and map each external library location to a stable MediaLyze root." collapseActions={<button type="button" className="secondary small settings-panel-header-action connector-action-button"><Plus aria-hidden="true" />Add connection</button>}>
                    <div className="notice">Connector accordions follow below the full-width description.</div>
                  </AsyncPanel>
                </div>
              </VariantCard>
              <VariantCard title="Shared connector accordion · expanded Jellyfin connection" source={`${settings} > Connectors`} classes={["library-settings-card", "connector-connection-card", "connector-connection-header", "connector-connection-header-main", "connector-connection-toggle", "connector-connection-url", "toggle-switch", "connector-enabled-switch", "connector-enabled-switch-track", "connector-enabled-switch-thumb", "library-settings-body", "connector-connection-body", "connector-form-grid", "connector-secret-action-button", "connector-users-section", "connector-users-toggle"]} wide>
                <article className="media-card library-settings-card connector-connection-card is-expanded">
                  <header className="connector-connection-header">
                    <div className="connector-connection-header-main"><label className="toggle-switch connector-enabled-switch" title="Disable"><input type="checkbox" role="switch" defaultChecked aria-label="Disable" /><span className="toggle-switch-track connector-enabled-switch-track" aria-hidden="true"><span className="toggle-switch-thumb connector-enabled-switch-thumb" /></span></label><button type="button" className="connector-connection-toggle" aria-expanded="true"><span className="connector-connection-chevron" aria-hidden="true"><ChevronDown className="nav-icon" /></span><span className="connector-connection-identity"><span className="connector-connection-title"><span className="connector-provider-icon" data-provider="jellyfin" title="Jellyfin"><ConnectorProviderIcon provider="jellyfin" aria-hidden="true" /><span className="sr-only">Jellyfin</span></span><strong>Living Room</strong><span className="connector-connection-url">https://living-room.example</span></span></span></button></div>
                    <span className="connector-status status-running">Running</span>
                  </header>
                  <div className="library-settings-body connector-connection-body">
                    <section className="connector-detail-section">
                      <div className="connector-form-grid"><label><span>Name</span><input className="settings-choice-input" defaultValue="Living Room" /></label><label><span>Server URL</span><input className="settings-choice-input" defaultValue="https://living-room.example" /></label><label><span>Sync interval (minutes)</span><input className="settings-choice-input" type="number" defaultValue="60" /></label></div>
                      <div className="jellyfin-actions"><button type="button" className="connector-action-button"><Check aria-hidden="true" />Save</button><button type="button" className="secondary small connector-action-button"><Link2 aria-hidden="true" />Test</button><button type="button" className="secondary small connector-action-button"><RefreshCw aria-hidden="true" />Sync now</button><button type="button" className="secondary small connector-action-button"><CircleStop aria-hidden="true" />Cancel sync</button><button type="button" className="secondary small connector-action-button connector-secret-action-button"><KeyRound aria-hidden="true" />Replace key</button><button type="button" className="secondary small danger connector-action-button"><Trash2 aria-hidden="true" />Remove</button></div>
                    </section>
                    <section className="connector-detail-section connector-mapping-section">
                      <div className="connector-mapping-section-header"><button type="button" className="connector-users-toggle connector-mapping-section-copy-toggle" aria-expanded="false"><div><h4>Library assignments</h4><p>Assign connector libraries automatically from verified paths or choose them manually.</p></div></button><div className="library-history-range-toggle connector-mapping-mode" role="group" aria-label="Library assignment mode"><SlidingTogglePill activeKey="automatic" className="nav-active-pill library-history-range-pill" /><button type="button" data-toggle-key="automatic" className="library-history-range-button active" aria-pressed="true"><span className="library-history-range-button-content"><span>Automatic</span></span></button><button type="button" data-toggle-key="manual" className="library-history-range-button" aria-pressed="false"><span className="library-history-range-button-content"><span>Manual</span></span></button></div><button type="button" className="connector-mapping-expand-toggle" aria-label="Expand Library assignments" aria-expanded="false"><ChevronRight className="nav-icon" /></button></div>
                    </section>
                    <section className="connector-detail-section connector-mapping-section">
                      <div className="connector-mapping-section-header"><button type="button" className="connector-users-toggle connector-mapping-section-copy-toggle" aria-expanded="false"><div><h4>Path mappings</h4><p>Map connector locations to one or more MediaLyze roots.</p></div></button><div className="library-history-range-toggle connector-mapping-mode" role="group" aria-label="Path mapping mode"><SlidingTogglePill activeKey="automatic" className="nav-active-pill library-history-range-pill" /><button type="button" data-toggle-key="automatic" className="library-history-range-button active" aria-pressed="true"><span className="library-history-range-button-content"><span>Automatic</span></span></button><button type="button" data-toggle-key="manual" className="library-history-range-button" aria-pressed="false"><span className="library-history-range-button-content"><span>Manual</span></span></button></div><button type="button" className="connector-mapping-expand-toggle" aria-label="Expand Path mappings" aria-expanded="false"><ChevronRight className="nav-icon" /></button></div>
                    </section>
                    <section className="connector-detail-section connector-users-section">
                      <button type="button" className="connector-users-toggle" aria-expanded="false"><div><h4>Analyzed users</h4><p>3 of 3 selected</p></div><ChevronRight aria-hidden="true" className="nav-icon" /></button>
                    </section>
                  </div>
                </article>
              </VariantCard>
              <VariantCard title="Connector mapping modes · auto, manual, stale, multi-root" source={`${settings} > Connectors > Connection`} classes={["connector-mapping-section", "connector-mapping-mode", "connector-mapping-card", "connector-technical-details", "settings-choice-input", "mapping-stale"]} wide>
                <section className="connector-detail-section connector-mapping-section">
                  <div className="connector-mapping-section-header"><button type="button" className="connector-users-toggle connector-mapping-section-copy-toggle" aria-expanded="true"><div><h4>Path mappings</h4><p>Map connector locations to one or more MediaLyze roots.</p></div></button><div className="library-history-range-toggle connector-mapping-mode" role="group" aria-label="Path mapping mode"><SlidingTogglePill activeKey="manual" className="nav-active-pill library-history-range-pill" /><button type="button" data-toggle-key="automatic" className="library-history-range-button" aria-pressed="false"><span className="library-history-range-button-content"><span>Automatic</span></span></button><button type="button" data-toggle-key="manual" className="library-history-range-button active" aria-pressed="true"><span className="library-history-range-button-content"><span>Manual</span></span></button></div><button type="button" className="connector-mapping-expand-toggle" aria-label="Collapse Path mappings" aria-expanded="true"><ChevronDown className="nav-icon" /></button></div>
                  <div className="connector-mapping-body">
                    <article className="connector-mapping-card"><div className="connector-mapping-row-main"><select className="settings-choice-input" defaultValue="movies"><option value="movies">Movies: /srv/jellyfin/movies</option></select><span>→</span><select className="settings-choice-input" defaultValue="root-a"><option value="root-a">Movies: Main</option></select><span className="badge mapping-verified">Verified</span></div><details className="connector-technical-details"><summary>Technical mapping fields</summary></details></article>
                    <article className="connector-mapping-card"><div className="connector-mapping-row-main"><select className="settings-choice-input" defaultValue="archive"><option value="archive">Movies: /archive/movies</option></select><span>→</span><select className="settings-choice-input" defaultValue="root-b"><option value="root-b">Movies: Archive</option></select><span className="badge mapping-stale">Stale</span></div><details className="connector-technical-details"><summary>Technical mapping fields</summary></details></article>
                  </div>
                </section>
              </VariantCard>
              <VariantCard title="Library assignment · required link and creation recommendation" source={`${settings} > Connectors > Connection`} classes={["connector-mapping-section", "connector-mapping-summary-card", "connector-library-assignment-row", "connector-library-choice", "connector-create-recommendation"]} wide>
                <section className="connector-detail-section connector-mapping-section"><div className="connector-mapping-section-header"><button type="button" className="connector-users-toggle connector-mapping-section-copy-toggle" aria-expanded="true"><div><h4>Library assignments</h4><p>Assign connector libraries automatically or manually.</p></div></button><div className="library-history-range-toggle connector-mapping-mode" role="group" aria-label="Library assignment mode"><SlidingTogglePill activeKey="automatic" className="nav-active-pill library-history-range-pill" /><button type="button" data-toggle-key="automatic" className="library-history-range-button active" aria-pressed="true"><span className="library-history-range-button-content"><span>Automatic</span></span></button><button type="button" data-toggle-key="manual" className="library-history-range-button" aria-pressed="false"><span className="library-history-range-button-content"><span>Manual</span></span></button></div><button type="button" className="connector-mapping-expand-toggle" aria-label="Collapse Library assignments" aria-expanded="true"><ChevronDown className="nav-icon" /></button></div><div className="connector-mapping-body"><div className="connector-mapping-summary-card"><div className="connector-mapping-summary"><strong>75% path coverage</strong><span>9 of 12 assets matched</span></div><div className="connector-mapping-coverage-track" aria-hidden="true"><span style={{ width: "75%" }} /></div></div><article className="connector-mapping-card connector-library-assignment-card"><div className="connector-library-assignment-row"><div className="connector-library-assignment-source"><strong>Movies</strong></div><span className="connector-library-assignment-arrow" aria-hidden="true">→</span><div className="connector-library-choice-list"><label className="connector-library-choice is-selected is-required"><input type="checkbox" defaultChecked disabled /><span>Movies</span><small>required by path mapping</small></label></div></div></article><article className="connector-mapping-card connector-library-assignment-card"><div className="connector-library-assignment-row"><div className="connector-library-assignment-source"><strong>Documentaries</strong></div><span className="connector-library-assignment-arrow" aria-hidden="true">→</span><div className="connector-library-choice-list"><label className="connector-library-choice"><input type="checkbox" /><span>Movies</span></label><details className="connector-technical-details connector-create-library-details" open><summary>Create a matching MediaLyze library</summary><div className="connector-create-recommendation connector-form-grid"><label><span>Name</span><input className="settings-choice-input" defaultValue="Documentaries" /></label><label><span>Local root path</span><input className="settings-choice-input" defaultValue="/media/documentaries" /></label><button type="button" className="secondary small connector-action-button">Create library</button></div></details></div></div></article></div></section>
              </VariantCard>
              <VariantCard title="Analyzed users · expanded, grouped, and searchable" source={`${settings} > Connectors > Connection`} classes={["connector-users-section", "connector-users-toggle", "connector-users-body", "jellyfin-user-selection", "jellyfin-user-search", "jellyfin-user-groups"]} wide>
                <section className="connector-detail-section connector-users-section">
                  <button type="button" className="connector-users-toggle" aria-expanded="true"><div><h4>Analyzed users</h4><p>2 of 3 selected</p></div><ChevronDown aria-hidden="true" className="nav-icon" /></button>
                  <div className="connector-users-body">
                    <div className="jellyfin-user-selection">
                      <div className="jellyfin-user-selection-toolbar"><label className="jellyfin-user-search"><Search aria-hidden="true" /><span className="sr-only">Search analyzed users</span><input type="search" placeholder="Search users…" /></label><div className="jellyfin-user-bulk-actions"><button type="button" className="secondary small jellyfin-user-bulk-button">Select all</button><button type="button" className="secondary small jellyfin-user-bulk-button">Select none</button></div></div>
                      <div className="jellyfin-user-groups"><section className="jellyfin-user-group"><div className="jellyfin-user-group-heading"><h5>Selected</h5><span className="badge">2</span></div><div className="jellyfin-user-list"><label><input type="checkbox" defaultChecked /><span>Alice</span></label><label><input type="checkbox" defaultChecked /><span>Bob</span></label></div></section><section className="jellyfin-user-group"><div className="jellyfin-user-group-heading"><h5>Not selected</h5><span className="badge">1</span></div><div className="jellyfin-user-list"><label><input type="checkbox" /><span>Guest</span></label></div></section></div>
                    </div>
                  </div>
                </section>
              </VariantCard>
              <VariantCard title="Shared connector accordion · collapsed connection" source={`${settings} > Connectors`} classes={["connector-connection-card", "is-collapsed", "connector-connection-header", "connector-connection-header-main", "connector-connection-toggle", "connector-connection-url", "toggle-switch", "connector-enabled-switch", "connector-enabled-switch-track", "connector-enabled-switch-thumb", "connector-status"]}>
                <article className="media-card library-settings-card connector-connection-card is-collapsed"><header className="connector-connection-header"><div className="connector-connection-header-main"><label className="toggle-switch connector-enabled-switch" title="Enable"><input type="checkbox" role="switch" aria-label="Enable" /><span className="toggle-switch-track connector-enabled-switch-track" aria-hidden="true"><span className="toggle-switch-thumb connector-enabled-switch-thumb" /></span></label><button type="button" className="connector-connection-toggle" aria-expanded="false"><span className="connector-connection-chevron" aria-hidden="true"><ChevronRight className="nav-icon" /></span><span className="connector-connection-identity"><span className="connector-connection-title"><span className="connector-provider-icon" data-provider="plex" title="Plex"><ConnectorProviderIcon provider="plex" aria-hidden="true" /><span className="sr-only">Plex</span></span><strong>Archive</strong><span className="connector-connection-url">https://archive.example</span></span></span></button></div><span className="connector-status status-success">Synchronized</span></header></article>
              </VariantCard>
              <VariantCard title="Add connector dialog · provider dropdown with Plex Soon™" source={`${settings} > Connectors > Add connection`} classes={["connector-add-dialog", "connector-provider-field", "settings-choice-input"]} wide>
                <section className="settings-create-library-dialog connector-add-dialog">
                  <div className="settings-create-library-dialog-header"><div><h2>Add connector</h2><p>Choose a provider and configure another media-server connection.</p></div><button type="button" className="secondary icon-only-button" aria-label="Close"><X aria-hidden="true" /></button></div>
                  <label className="connector-provider-field"><span>Provider</span><select className="settings-choice-input" defaultValue="jellyfin"><option value="jellyfin">Jellyfin</option><option value="plex" disabled>Plex — Soon™</option></select></label>
                  <div className="connector-form-grid"><label><span>Name</span><input className="settings-choice-input" defaultValue="Archive" /></label><label><span>Server URL</span><input className="settings-choice-input" defaultValue="https://archive.example" /></label><label><span>API key / secret</span><input className="settings-choice-input" type="password" defaultValue="configured-key" /></label></div>
                </section>
              </VariantCard>
              <VariantCard title="Collapsed MediaLyze library settings with active scan" source={`${settings} > Libraries`} classes={["library-settings-card", "is-collapsed", "library-settings-chevron", "library-scan-progress"]} wide>
                <article className="media-card library-settings-card is-collapsed">
                  <div className="library-settings-header">
                    <div className="item-meta">
                      <div className="library-title-row">
                        <div className="library-title-meta">
                          <div className="library-title-main">
                            <div className="library-title-heading"><button type="button" className="library-settings-chevron" aria-label="Show settings for Movies" aria-expanded="false"><ChevronRight aria-hidden="true" className="nav-icon" /></button><h3>Movies</h3></div>
                            <div className="meta-tags library-title-tags"><span className="badge">Movies</span><span className="badge">Manual</span></div>
                          </div>
                        </div>
                        <div className="library-title-actions">
                          <button type="button" className="secondary icon-only-button" aria-label="Delete Movies"><Trash2 aria-hidden="true" /></button>
                          <button type="button" className="small library-scan-button">Manual scan</button>
                        </div>
                      </div>
                    </div>
                  </div>
                  <div className="progress library-scan-progress"><span style={{ width: "42%" }} /></div>
                </article>
              </VariantCard>
              <VariantCard title="Expanded MediaLyze library settings" source={`${settings} > Libraries`} classes={["library-settings-card", "is-expanded", "library-settings-body", "library-settings-section", "settings-choice-input"]} wide>
                <article className="media-card library-settings-card is-expanded">
                  <div className="library-settings-header">
                    <div className="item-meta"><div className="library-title-row"><div className="library-title-meta"><div className="library-title-main"><div className="library-title-heading"><button type="button" className="library-settings-chevron" aria-label="Hide settings for Movies" aria-expanded="true"><ChevronDown aria-hidden="true" className="nav-icon" /></button><h3>Movies</h3></div><div className="meta-tags library-title-tags"><span className="badge">Movies</span><span className="badge">Manual</span></div></div></div><div className="library-title-actions"><button type="button" className="small library-scan-button">Manual scan</button></div></div></div>
                  </div>
                  <div className="library-settings-body">
                    <section className="library-settings-section"><div className="library-settings-section-heading"><h4>Jellyfin association</h4><p>Choose the Jellyfin catalog that enriches this MediaLyze library.</p></div><div className="library-settings-section-grid is-single-column"><div className="field"><label htmlFor="catalog-medialyze-jellyfin-link">Associated Jellyfin library</label><select id="catalog-medialyze-jellyfin-link" className="settings-choice-input" defaultValue="movies"><option value="">No associated library</option><option value="movies">Movies</option><option value="archive">Archive (Archive library)</option></select></div><div id="path-mapping" className="library-jellyfin-path-mappings"><div className="library-jellyfin-path-mappings-heading"><div className="library-jellyfin-path-mappings-title"><h5>Path mapping (optional)</h5><TooltipTrigger ariaLabel="Explain path mapping" content="Use this when Jellyfin and MediaLyze see the same files under different mount points.">?</TooltipTrigger><span className="library-jellyfin-path-mapping-state is-partial">Partially enabled</span></div><label className="toggle-switch library-jellyfin-path-mapping-switch is-partial" title="Enable all path mappings"><input type="checkbox" role="switch" aria-label="Enable all path mappings" aria-checked="mixed" /><span className="toggle-switch-track library-jellyfin-path-mapping-switch-track" aria-hidden="true"><span className="toggle-switch-thumb library-jellyfin-path-mapping-switch-thumb" /></span></label></div><div className="library-jellyfin-path-mapping-row"><div className="field library-jellyfin-path-source"><span className="field-label">Jellyfin path</span><code>/jellyfin/movies</code></div><span className="library-jellyfin-path-arrow" aria-hidden="true">→</span><div className="field library-jellyfin-path-target"><label htmlFor="catalog-jellyfin-path-target">MediaLyze path</label><input id="catalog-jellyfin-path-target" className="settings-choice-input" defaultValue="/media/movies" /></div><div className="library-jellyfin-path-mapping-actions"><button type="button" className="secondary icon-only-button library-jellyfin-path-save-button is-dirty" aria-label="Save mapping" title="Save mapping"><Save aria-hidden="true" /></button></div></div></div></div></section>
                    <section className="library-settings-section"><div className="library-settings-section-heading"><div className="library-settings-section-title"><h4>Media source</h4><TooltipTrigger ariaLabel="Explain the media source settings" content="Manage the local folders MediaLyze scans. Changing paths keeps existing library configuration and history.">?</TooltipTrigger></div></div><div className="library-settings-section-grid is-single-column"><div className="field library-source-field"><div className="field-label-row"><span>MediaLyze paths</span><button type="button" className="secondary small settings-panel-header-action library-change-path-button"><Plus aria-hidden="true" />Change path</button></div><div className="library-source-paths"><div className="library-root-row"><div className="library-root-alias-control"><label className="library-root-alias-field"><span>Root alias</span><input className="library-root-alias-input" defaultValue="Movies" /></label><label className="library-root-path-field"><span>MediaLyze paths</span><input className="library-root-path-input" value="/media/movies" readOnly /></label><button type="button" className="secondary icon-only-button library-root-alias-save-button" aria-label="Save root alias" title="Save root alias"><Save aria-hidden="true" /></button></div></div></div></div></div></section>
                    <section className="library-settings-section"><div className="library-settings-section-heading"><h4>Scanning and analysis</h4><p>Configure when this library is scanned and how its files are evaluated.</p></div><div className="library-settings-form"><div className="field"><label htmlFor="catalog-library-scan-mode">Scan mode</label><select id="catalog-library-scan-mode" className="settings-choice-input" defaultValue="manual"><option value="manual">Manual</option></select></div><div className="field"><label htmlFor="catalog-library-duplicates">Duplicate detection</label><select id="catalog-library-duplicates" className="settings-choice-input" defaultValue="off"><option value="off">Off</option></select></div></div></section>
                  </div>
                </article>
              </VariantCard>
              <VariantCard title="Create library from detected Jellyfin catalog" source={`${settings} > Libraries > Add library`} classes={["jellyfin-create-library-options", "jellyfin-create-library-option"]} wide>
                <section className="jellyfin-create-library-options"><div><h3>Add a detected Jellyfin library</h3><p className="field-hint">Select a catalog, then choose its local media path.</p></div><div className="jellyfin-create-library-option-list"><button type="button" className="jellyfin-create-library-option is-selected" aria-pressed="true"><strong>Archive</strong><span>420 Jellyfin items</span></button><button type="button" className="jellyfin-create-library-option" aria-pressed="false"><strong>Concerts</strong><span>88 Jellyfin items</span></button></div><div className="notice success">The Jellyfin library will be linked automatically after creation.</div></section>
              </VariantCard>
              <VariantCard title="Jellyfin-linked MediaLyze library" source="LibraryDetailPage" classes={["library-statistic-title-row", "library-jellyfin-icon-trigger", "analyzed-file-name-source-toggle"]} wide>
                <div className="stack">
                  <section className="panel stack statistic-layout-header-panel library-statistic-layout-header-panel">
                    <div className="panel-title-row library-statistic-title-row"><h2>Movies</h2><TooltipTrigger ariaLabel="Connected to Jellyfin library Movies" className="library-jellyfin-icon-trigger" content={<span className="library-jellyfin-icon-tooltip"><strong>Connected to Jellyfin library Movies</strong><span>Last synchronization: today</span></span>}><JellyfinIcon aria-hidden="true" /></TooltipTrigger><TooltipTrigger ariaLabel="Show library path" content="/media/movies">?</TooltipTrigger></div>
                    <div className="card-grid grid"><StatCard label="Files" value="248" /><StatCard label="Storage" value="1.2 TB" tone="teal" /><StatCard label="Duration" value="19d 4h" tone="blue" /><StatCard label="Last scan" value="Today" /></div>
                  </section>
                  <section className="panel">
                    <div className="panel-title-row">
                      <h2>Analyzed files</h2>
                      <div className="analyzed-files-title-addon">
                        <div className="distribution-chart-mode-toggle analyzed-file-name-source-toggle" role="group" aria-label="Displayed file name">
                          <SlidingTogglePill activeKey="file" className="nav-active-pill distribution-chart-mode-pill" />
                          <button type="button" data-toggle-key="file" className="distribution-chart-mode-button analyzed-file-name-source-button active" aria-label="Show file names" aria-pressed="true"><span className="distribution-chart-mode-button-content"><FileText aria-hidden="true" className="distribution-chart-mode-icon" /></span></button>
                          <button type="button" data-toggle-key="jellyfin" className="distribution-chart-mode-button analyzed-file-name-source-button" aria-label="Show Jellyfin names" aria-pressed="false"><span className="distribution-chart-mode-button-content"><JellyfinIcon aria-hidden="true" className="distribution-chart-mode-icon" /></span></button>
                        </div>
                        <button type="button" className="secondary icon-only-button statistic-layout-action-button" aria-label="Edit table view"><Settings aria-hidden="true" /></button>
                      </div>
                    </div>
                    <div className="media-data-table" role="table">
                      <div className="media-data-row" role="row">
                        <div className="media-data-cell media-file-cell" role="cell">
                          <span className="media-file-cell-copy">
                            <span className="file-link">Arrival.2016.UHD.mkv</span>
                          </span>
                        </div>
                      </div>
                    </div>
                  </section>
                </div>
              </VariantCard>
            </VariantGroup>
          </CatalogSection>

          <CatalogSection definition={catalogSections[3]}>
            <VariantGroup title="Form families">
              <VariantCard title="Basic form grid and feature flag" source={`${settings} > Create library / App settings`} classes={["form-grid", "field", "field-hint", "settings-choice-input", "app-settings-flag-row", "app-settings-flag-toggle"]}>
                <div className="form-grid ui-elements-form-grid">
                  <div className="field">
                    <label htmlFor="ui-library-name">Name</label>
                    <input id="ui-library-name" className="settings-choice-input" defaultValue="Movies archive" />
                    <p className="field-hint">Compact settings input surface.</p>
                  </div>
                  <div className="field">
                    <label htmlFor="ui-library-type">Media type</label>
                    <select id="ui-library-type" className="settings-choice-input" defaultValue="movies">
                      <option value="movies">Movies</option>
                      <option value="series">Series</option>
                    </select>
                  </div>
                  <div className="app-settings-flag-row">
                    <label className="app-settings-flag-toggle">
                      <input type="checkbox" />
                      <span>Hide automatic update reminders</span>
                    </label>
                    <TooltipTrigger
                      ariaLabel="Explain hiding automatic update reminders"
                      content="Prevents newer stable releases from opening automatically. Update checks and the manual update indicator remain available."
                    >
                      ?
                    </TooltipTrigger>
                  </div>
                  <div className="app-settings-flag-row">
                    <label className="app-settings-flag-toggle">
                      <input type="checkbox" defaultChecked />
                      <span>Show all playbacks when unstacked</span>
                    </label>
                    <TooltipTrigger
                      ariaLabel="Explain showing all unstacked playbacks"
                      content="Shows every available playback event without table pagination in the unstacked view."
                    >
                      ?
                    </TooltipTrigger>
                  </div>
                </div>
              </VariantCard>
              <VariantCard title="Structured search" source={`${libraryDetail} > Analyzed files`} classes={["async-panel-header-status", "metadata-search-fields", "metadata-search-control", "metadata-search-icon-button", "metadata-search-remove", "data-table-search-layout"]}>
                <div className="stack">
                  <div className="library-layout-panel-analyzed-files">
                    <div className="panel-header">
                      <div className="data-table-search-layout">
                        <div className="metadata-search-control metadata-search-control-base search-filter-picker">
                          <button type="button" className="search-filter-picker-button" aria-label="Add metadata search field">
                            <Plus size={18} aria-hidden="true" />
                          </button>
                          <span className="metadata-search-icon-button metadata-search-icon-button-middle" aria-hidden="true">
                            <Search size={16} />
                          </span>
                          <input type="search" placeholder="Search file and path" aria-label="Search files and metadata" />
                        </div>
                      </div>
                    </div>
                  </div>
                  <SearchFilterFixture />
                  <SearchFilterFixture invalid />
                </div>
              </VariantCard>
              <VariantCard title="Ignore pattern rows" source={`${settings} > Ignore patterns`} classes={["ignore-pattern-section", "ignore-pattern-row", "settings-choice-input", "ignore-pattern-action-button"]} wide>
                <IgnorePatternFixture />
              </VariantCard>
              <VariantCard title="Quality profiles list and metric accordions" source={`${settings} > Quality profiles`} classes={["compatibility-profile-list", "compatibility-profile-list-item", "compatibility-profile-list-trigger", "quality-profile-toggle-row", "quality-profile-list-row", "transcode-automation-tab-list", "transcode-automation-tab-button", "quality-profile-details", "quality-profile-action-button", "quality-profile-metric-list", "quality-profile-metric-item", "quality-profile-metric-toggle", "quality-profile-weight-input"]} wide>
                <QualityProfileFixture />
              </VariantCard>
            </VariantGroup>
          </CatalogSection>

          <CatalogSection definition={catalogSections[4]}>
            <VariantGroup title="Button and action variants">
              <VariantCard title="Global button variants" source={`${source}: globals.css`} classes={["button", "secondary", "ghost", "small"]}>
                <div className="ui-elements-control-grid">
                  <button type="button">Primary</button>
                  <button type="button" className="secondary">Secondary</button>
                  <button type="button" className="ghost">Ghost</button>
                  <button type="button" className="secondary small">Small</button>
                  <button type="button" disabled>Disabled</button>
                </div>
              </VariantCard>
              <VariantCard title="Statistic layout actions" source={`${dashboard} / ${libraryDetail}`} classes={["statistic-layout-controls", "statistic-layout-action-button", "statistic-layout-menu"]}>
                <StatisticPanelLayoutControls
                  availableDefinitions={availablePanelDefinitions}
                  isEditing
                  onStartEditing={() => undefined}
                  onCancelEditing={() => undefined}
                  onRestoreDefault={() => undefined}
                  onSaveEditing={() => undefined}
                  onAddPanel={() => undefined}
                />
              </VariantCard>
              <VariantCard
                title="Page-specific icon buttons"
                source={`${scanLogs} / ${fileDetail} / ${libraryDetail}`}
                classes={[
                  "icon-button",
                  "icon-button-borderless",
                  "icon-button-bordered",
                  "icon-button-static",
                  "icon-button-animated",
                  "scan-log-copy-button",
                  "file-detail-cover-button",
                  "duplicate-group-open-button",
                  "library-quickscan-button",
                  "file-detail-navigation-actions",
                ]}
              >
                <div className="ui-elements-control-grid">
                  <button type="button" className="icon-button icon-button-bordered icon-button-static scan-log-copy-button" aria-label="Copy">
                    <Copy className="nav-icon" aria-hidden="true" />
                  </button>
                  <button type="button" className="file-detail-cover-button secondary small"><Download className="nav-icon" /> Download cover</button>
                  <button type="button" className="icon-button icon-button-borderless icon-button-static duplicate-group-open-button" aria-label="Open">
                    <ArrowUpRight className="duplicate-group-open-icon" aria-hidden="true" />
                  </button>
                  <button type="button" className="icon-button icon-button-borderless icon-button-static duplicate-group-action duplicate-group-compare-action" aria-label="Compare">
                    <GitCompareArrowsIcon className="duplicate-group-action-icon" size={17} aria-hidden="true" />
                  </button>
                  <button type="button" className="icon-button icon-button-borderless icon-button-animated statistic-layout-action-button library-quickscan-button" aria-label="Quick scan" title="Quick scan">
                    <AnimatedSearchIcon className="statistic-layout-action-icon" size={18} aria-hidden="true" />
                  </button>
                  <button type="button" className="secondary small settings-panel-header-action file-detail-navigation-back-button" aria-label="Back" title="Back">
                    <ArrowLeft className="nav-icon" aria-hidden="true" />
                    <span>Back</span>
                  </button>
                </div>
              </VariantCard>
            </VariantGroup>
          </CatalogSection>

          <CatalogSection definition={catalogSections[5]}>
            <VariantGroup title="Panel shells and layout editing">
              <VariantCard title="AsyncPanel states" source={`${dashboard} / ${libraryDetail} / ${fileDetail}`} classes={["async-panel", "panel-loader", "alert"]} wide>
                <div className="ui-elements-panel-grid">
                  <AsyncPanel title="Normal panel" subtitle="Shared panel shell">
                    <DistributionList items={distributionItems} />
                  </AsyncPanel>
                  <AsyncPanel title="Loading panel" loading><span /></AsyncPanel>
                  <AsyncPanel title="Refreshing panel" refreshing>
                    <DistributionList items={distributionItems} />
                  </AsyncPanel>
                  <AsyncPanel title="Error panel" error="Example error"><span /></AsyncPanel>
                  <AsyncPanel
                    title="Collapsed panel"
                    collapseState={{ collapsed, onToggle: () => setCollapsed((value) => !value) }}
                    collapseActions={<button type="button" className="secondary icon-only-button"><SlidersHorizontal className="nav-icon" /></button>}
                  >
                    <PanelEmptyState />
                  </AsyncPanel>
                </div>
              </VariantCard>
              <VariantCard title="Statistic layout edit overlay" source={`${dashboard} > Layout editor`} classes={["statistic-layout-grid", "statistic-layout-overlay", "statistic-layout-size-button"]} wide>
                <StatisticLayoutFixture />
              </VariantCard>
              <VariantCard title="Migration notice" source={`${dashboard} / ${libraryDetail} > Saved layouts`} classes={["statistic-layout-migration-notice", "notice"]}>
                <StatisticPanelLayoutMigrationNotice
                  scope="dashboard"
                  issues={[{ kind: "resized_panel", statisticId: "comparison", instanceId: "comparison-1", axis: "height", requested: 9, applied: 4 }]}
                />
              </VariantCard>
              <VariantCard title="Empty states" source={`${libraryDetail} > Duplicates / Panels`} classes={["panel-empty-state", "duplicate-panel-empty-state"]}>
                <div className="ui-elements-empty-grid">
                  <PanelEmptyState message="No data yet" />
                  <DuplicatePanelEmptyState message="No duplicates found" />
                </div>
              </VariantCard>
            </VariantGroup>
          </CatalogSection>

          <CatalogSection definition={catalogSections[6]}>
            <VariantGroup title="Table surfaces">
              <VariantCard title="Analyzed files virtual table" source={`${libraryDetail} > Analyzed files`} classes={["data-table-shell", "media-data-table", "score-meter"]} wide>
                <div className="data-table-tools">
                  <div className="column-picker">
                    <button type="button" className="column-toggle is-active"><Columns3 className="nav-icon" /> Container</button>
                    <button type="button" className="column-toggle is-active">Codec</button>
                    <button type="button" className="column-toggle">Bitrate</button>
                    <button type="button" className="column-toggle" disabled>Path</button>
                  </div>
                </div>
                <AnalyzedFilesTable />
              </VariantCard>
              <VariantCard
                title="Resolution category restore action"
                source={`${settings} > Resolution categories`}
                classes={["resolution-categories-async-panel", "panel-title-row", "async-panel-toggle-actions", "resolution-category-restore-button"]}
                wide
              >
                <div className="resolution-categories-async-panel">
                  <div className="panel-title-row">
                    <h2>Resolution categories</h2>
                    <TooltipTrigger
                      ariaLabel="Explain reduced default resolution thresholds"
                      content={[
                        "Use shared buckets for statistics, metadata search, file detail, and quality-score resolution rules.",
                        "",
                        "Default buckets intentionally use 5% lower minimum width and height thresholds so cropped and cinema-scope encodes still land in the expected format bucket.",
                        "Reference dimensions:",
                        "8k: 7680x4320",
                        "4k / UHD: 3840x2160",
                        "1080p / Full HD: 1920x1080",
                        "720p / HD: 1280x720",
                      ].join("\n")}
                      preserveLineBreaks
                    >
                      ?
                    </TooltipTrigger>
                    <div className="async-panel-toggle-actions">
                      <TooltipTrigger
                        ariaLabel="Restore defaults"
                        content="Restore defaults"
                        className="secondary icon-only-button resolution-category-restore-button"
                        pinOnClick={false}
                      >
                        <History aria-hidden="true" className="nav-icon" size={16} />
                      </TooltipTrigger>
                    </div>
                  </div>
                </div>
              </VariantCard>
              <VariantCard
                title="Resolution categories add and delete actions"
                source={`${settings} > Resolution categories`}
                classes={["resolution-category-table-shell", "resolution-category-table", "resolution-category-add", "resolution-category-action-button"]}
                wide
              >
                <div className="settings-sidebar-stack">
                  <div className="resolution-category-table-shell">
                    <table className="resolution-category-table">
                      <thead>
                        <tr><th>Label</th><th>Min width</th><th>Min height</th><th><span className="sr-only">Actions</span></th></tr>
                      </thead>
                      <tbody>
                        <tr>
                          <td><input className="settings-choice-input" value="4k" readOnly aria-label="Label" /></td>
                          <td><input className="settings-choice-input" value="3648" readOnly aria-label="Min width" /></td>
                          <td><input className="settings-choice-input" value="1520" readOnly aria-label="Min height" /></td>
                          <td>
                            <button type="button" className="secondary icon-only-button resolution-category-action-button" aria-label="Remove resolution category 4k">
                              <DeleteIcon size={18} aria-hidden="true" className="nav-icon" />
                            </button>
                          </td>
                        </tr>
                      </tbody>
                    </table>
                  </div>
                  <button type="button" className="secondary small settings-panel-header-action resolution-category-add">
                    <Plus size={15} aria-hidden="true" /> Add category
                  </button>
                </div>
              </VariantCard>
              <VariantCard title="Settings table" source={`${settings} > Resolution categories`} classes={["settings-table-shell", "settings-data-table"]}>
                <div className="settings-table-shell">
                  <table className="settings-data-table">
                    <thead><tr><th>Name</th><th>Minimum</th><th>Actions</th></tr></thead>
                    <tbody>
                      <tr><td>4K</td><td>3840x2160</td><td><button type="button" className="secondary small">Edit</button></td></tr>
                      <tr><td>1080p</td><td>1920x1080</td><td><button type="button" className="secondary small">Edit</button></td></tr>
                    </tbody>
                  </table>
                </div>
              </VariantCard>
              <VariantCard title="Scan summary table" source={`${scanLogs} > Scan detail`} classes={["scan-log-summary-table-shell", "scan-log-summary-table"]}>
                <div className="scan-log-summary-table-shell">
                  <table className="scan-log-summary-table">
                    <tbody>
                      <tr><th>New</th><td>42</td></tr>
                      <tr><th>Modified</th><td>18</td></tr>
                      <tr><th>Errors</th><td>3</td></tr>
                    </tbody>
                  </table>
                </div>
              </VariantCard>
            </VariantGroup>
          </CatalogSection>

          <CatalogSection definition={catalogSections[7]}>
            <VariantGroup title="Statistics and charts">
              <VariantCard title="Stat cards" source={dashboard} classes={["media-card", "metric-card", "stat-card"]}>
                <div className="card-grid grid ui-elements-stat-grid">
                  <StatCard label="Libraries" value="4" />
                  <StatCard label="Files" value="12,482" tone="teal" />
                  <StatCard label="Storage" value="18.7 TB" tone="blue" />
                </div>
              </VariantCard>
              <VariantCard title="Distribution list" source={`${dashboard} / ${libraryDetail}`} classes={["distribution-list", "distribution-item", "distribution-bar"]}>
                <DistributionList items={distributionItems} />
              </VariantCard>
              <VariantCard title="Playback by user" source={`${libraryDetail} > Linked Jellyfin library`} classes={["async-panel", "distribution-list", "distribution-row"]}>
                <AsyncPanel title="Plays by user">
                  <DistributionList
                    items={[
                      { label: "Frederik", value: 18 },
                      { label: "Louise", value: 11 },
                      { label: "Kids", value: 6 },
                    ]}
                  />
                </AsyncPanel>
              </VariantCard>
              <VariantCard title="Distribution chart panel" source={`${libraryDetail} > Numeric panel`} classes={["async-panel", "distribution-chart-mode-toggle", "distribution-chart-canvas"]} wide>
                <DistributionChartPanel title="Quality score" distribution={numericDistribution} metricId="quality_score" />
              </VariantCard>
              <VariantCard title="Connected library history controls" source={`${libraryDetail} > Media library history`} classes={["library-history-panel", "library-history-actions", "library-history-range-toggle", "library-history-range-button", "distribution-chart-mode-toggle", "distribution-chart-mode-button", "library-history-toolbar", "library-history-picker-button"]} wide>
                <section className="panel library-history-panel">
                  <div className="panel-title-row panel-title-row-with-actions">
                    <h2>Media library history</h2>
                    <div className="library-history-actions">
                      <div className="library-history-range-toggle" role="group" aria-label="Select history range">
                        <SlidingTogglePill activeKey="30d" className="nav-active-pill library-history-range-pill" />
                        <button type="button" data-toggle-key="7d" className="library-history-range-button" aria-pressed="false"><span className="library-history-range-button-content"><span>7d</span></span></button>
                        <button type="button" data-toggle-key="30d" className="library-history-range-button active" aria-pressed="true"><span className="library-history-range-button-content"><span>30d</span></span></button>
                        <button type="button" data-toggle-key="1y" className="library-history-range-button" aria-pressed="false"><span className="library-history-range-button-content"><span>1y</span></span></button>
                        <button type="button" data-toggle-key="all" className="library-history-range-button" aria-pressed="false"><span className="library-history-range-button-content"><span>All</span></span></button>
                        <div className="library-history-range-custom-shell" data-toggle-key="custom">
                          <button type="button" className="library-history-range-button library-history-range-button-custom" aria-pressed="false"><span className="library-history-range-button-content"><CalendarDays aria-hidden="true" className="distribution-chart-mode-icon" /><span>Custom</span></span></button>
                        </div>
                      </div>
                      <div className="distribution-chart-mode-toggle" role="group" aria-label="Chart display mode">
                        <SlidingTogglePill activeKey="count" className="nav-active-pill distribution-chart-mode-pill" />
                        <button type="button" data-toggle-key="count" className="distribution-chart-mode-button active" aria-label="Count" aria-pressed="true"><span className="distribution-chart-mode-button-content"><Hash aria-hidden="true" className="distribution-chart-mode-icon" /></span></button>
                        <button type="button" data-toggle-key="percentage" className="distribution-chart-mode-button" aria-label="Percentage" aria-pressed="false"><span className="distribution-chart-mode-button-content"><Percent aria-hidden="true" className="distribution-chart-mode-icon" /></span></button>
                      </div>
                      <div className="library-history-toolbar search-filter-picker">
                        <button type="button" className="search-filter-picker-button search-filter-picker-button-standalone library-history-picker-button" aria-label="Resolution mix" aria-haspopup="menu" aria-expanded="false">
                          <Layers size={18} aria-hidden="true" />
                          <span className="library-history-picker-button-label">Resolution mix</span>
                        </button>
                      </div>
                    </div>
                  </div>
                </section>
              </VariantCard>
              <VariantCard title="Comparison chart panel with Jellyfin playback axes" source={`${dashboard} / ${libraryDetail} > Metric comparison`} classes={["async-panel", "comparison-chart-toolbar", "comparison-chart-select", "comparison-chart-content"]} wide>
                <ComparisonChartFixture />
              </VariantCard>
            </VariantGroup>
          </CatalogSection>

          <CatalogSection definition={catalogSections[8]}>
            <VariantGroup title="Runtime and scan logs">
              <VariantCard title="Active scan cards" source={`${source}: Header scan banner`} classes={["scan-job-card", "is-indeterminate", "is-determinate"]} wide>
                <div className="scan-banner-list">
                  <ScanJobFixture />
                  <ScanJobFixture determinate />
                </div>
              </VariantCard>
              <VariantCard title="Active connector synchronization" source={`${source}: Header scan banner`} classes={["scan-banner", "scan-job-card", "connector-sync-job-card", "scan-job-metrics"]} wide>
                <div className="scan-banner-list">
                  <div className="scan-job-card connector-sync-job-card is-determinate" style={{ "--scan-progress": "60%" } as React.CSSProperties}>
                    <div className="scan-job-card-main">
                      <span className="scan-job-card-search-icon connector-sync-provider-icon" aria-hidden="true"><ConnectorProviderIcon provider="jellyfin" /></span>
                      <span className="scan-job-card-name">Living Room</span>
                      <div className="scan-job-metrics">
                        <span className="scan-job-metric-item"><span className="scan-job-metric-icon-wrap" title="Current synchronization phase: Mirroring user states"><Activity size={14} aria-hidden="true" /><span className="scan-job-metric-value">Mirroring user states</span></span></span>
                        <span className="scan-job-metric-item"><span className="scan-job-metric-sep" aria-hidden="true" /><span className="scan-job-metric-icon-wrap" title="14,646 of 14,646 assets synchronized"><Files size={14} aria-hidden="true" /><span className="scan-job-metric-value">14,646 / 14,646</span></span></span>
                        <span className="scan-job-metric-item"><span className="scan-job-metric-sep" aria-hidden="true" /><span className="scan-job-metric-icon-wrap" title="User states processed for 3 of 5 users"><UserRoundCheck size={14} aria-hidden="true" /><span className="scan-job-metric-value">3 / 5</span></span></span>
                      </div>
                      <div className="scan-job-card-actions"><button type="button" className="secondary icon-only-button scan-banner-stop" aria-label="Stop this synchronization"><CircleStop size={16} aria-hidden="true" /></button></div>
                    </div>
                  </div>
                </div>
              </VariantCard>
              <VariantCard title="Transcoding job center" source="TranscodingPage" classes={["transcoding-center-panel", "transcoding-center-heading", "transcoding-center-tabs", "library-history-range-toggle", "library-history-range-pill", "library-history-range-button", "transcoding-center-tab-count", "transcoding-reset-button", "transcoding-job-table", "column-sort", "sort-indicator", "transcoding-progress-summary", "transcoding-progress-metrics", "transcoding-progress-metric", "transcoding-progress-chart", "transcoding-progress-meta", "transcoding-progress-static", "column-resize-handle", "transcoding-job-row", "transcoding-job-detail-row", "transcoding-job-detail-grid", "transcoding-job-detail-time", "transcoding-job-detail-list", "transcoding-job-transform-list", "transcoding-job-command", "transcoding-detail-links", "transcoding-hardware-load", "transcoding-hardware-load-trigger", "transcoding-hardware-load-slots", "transcoding-hardware-load-slot", "settings-choice-input"]} wide>
                <div className="transcoding-center-panel">
                  <div className="transcoding-center-header">
                    <div className="transcoding-center-heading">
                      <div className="transcoding-center-title-block">
                        <div className="transcoding-center-title-row"><Activity aria-hidden="true" className="transcoding-center-title-icon" /><h2>Transcoding</h2></div>
                      </div>
                      <section className="transcoding-hardware-load is-compact" aria-label="Hardware load">
                        <div className="transcoding-hardware-load-items">
                          <TooltipTrigger ariaLabel="Show hardware load details for RTX 3080" tooltipClassName="transcode-matrix-tooltip-portal" content={<div className="transcode-matrix-tooltip-content"><div className="transcode-matrix-tooltip-heading"><strong>RTX 3080</strong><span className="transcode-matrix-tooltip-status is-hardware">Hardware path</span></div><div className="transcode-matrix-tooltip-summary"><div><span>Slots</span><strong>1/2</strong></div><div><span>Backend</span><strong>CUDA</strong></div></div></div>} className="transcoding-hardware-load-trigger status-available"><span className="transcoding-hardware-load-icon status-available" aria-hidden="true"><HardDrive /></span><span className="transcoding-hardware-load-short-label">CUDA</span><span className="transcoding-hardware-load-slots" aria-hidden="true"><span className="transcoding-hardware-load-slot is-busy" /><span className="transcoding-hardware-load-slot is-free" /></span></TooltipTrigger>
                          <TooltipTrigger ariaLabel="Show hardware load details for CPU" tooltipClassName="transcode-matrix-tooltip-portal" content={<div className="transcode-matrix-tooltip-content"><div className="transcode-matrix-tooltip-heading"><strong>CPU</strong><span className="transcode-matrix-tooltip-status is-software">Software only</span></div><div className="transcode-matrix-tooltip-summary"><div><span>Slots</span><strong>Automatic</strong></div><div><span>Backend</span><strong>Software path</strong></div></div></div>} className="transcoding-hardware-load-trigger status-cpu"><span className="transcoding-hardware-load-icon status-cpu" aria-hidden="true"><Cpu /></span><span className="transcoding-hardware-load-short-label">CPU</span><span className="transcoding-hardware-load-slots" aria-hidden="true"><span className="transcoding-hardware-load-slot is-automatic" /></span></TooltipTrigger>
                        </div>
                      </section>
                    </div>
                    <div className="transcoding-center-tabs library-history-range-toggle" role="tablist" aria-label="Transcoding views">
                      <SlidingTogglePill activeKey="active" className="nav-active-pill library-history-range-pill" />
                      <button type="button" role="tab" data-toggle-key="active" className="library-history-range-button active" aria-pressed="true"><span className="library-history-range-button-content"><span>Active</span><span className="transcoding-center-tab-count">8</span></span></button>
                      <button type="button" role="tab" data-toggle-key="history" className="library-history-range-button" aria-pressed="false"><span className="library-history-range-button-content"><span>History</span><span className="transcoding-center-tab-count">19</span></span></button>
                    </div>
                  </div>
                  <div className="transcoding-center-toolbar">
                    <label className="transcoding-search-field"><Search aria-hidden="true" /><input type="search" placeholder="Search files…" /></label>
                    <label className="transcoding-filter-field"><span>Status</span><select className="settings-choice-input" defaultValue="all"><option value="all">All statuses</option></select></label>
                    <label className="transcoding-filter-field"><span>Hardware</span><select className="settings-choice-input" defaultValue="all"><option value="all">All hardware</option></select></label>
                    <TooltipTrigger ariaLabel="Reset filters" content="Reset filters" className="secondary icon-only-button transcoding-reset-button" pinOnClick={false}><History aria-hidden="true" className="nav-icon" size={16} /></TooltipTrigger>
                  </div>
                  <div className="transcoding-table-scroll">
                    <table className="transcoding-job-table">
                      <colgroup><col style={{ width: "26%" }} /><col style={{ width: "17%" }} /><col style={{ width: "18%" }} /><col style={{ width: "33%" }} /><col style={{ width: "6%" }} /></colgroup>
                       <thead><tr><th aria-sort="none" style={{ width: "26%" }}><button type="button" className="column-sort"><span>File</span><span className="sort-indicator" aria-hidden="true" /></button><button type="button" className="column-resize-handle" aria-label="Resize column File" /></th><th aria-sort="none" style={{ width: "17%" }}><button type="button" className="column-sort"><span>Target</span><span className="sort-indicator" aria-hidden="true" /></button><button type="button" className="column-resize-handle" aria-label="Resize column Target" /></th><th aria-sort="none" style={{ width: "18%" }}><button type="button" className="column-sort"><span>Hardware</span><span className="sort-indicator" aria-hidden="true" /></button><button type="button" className="column-resize-handle" aria-label="Resize column Hardware" /></th><th aria-sort="none" style={{ width: "33%" }}><button type="button" className="column-sort"><span>Progress</span><span className="sort-indicator" aria-hidden="true" /></button><button type="button" className="column-resize-handle" aria-label="Resize column Progress" /></th><th style={{ width: "6%" }}>Actions<button type="button" className="column-resize-handle" aria-label="Resize column Actions" /></th></tr></thead>
                      <tbody>
                        <tr className="transcoding-job-row status-running is-expanded" tabIndex={0} aria-expanded="true">
                          <td className="transcoding-file-cell"><span className="transcoding-status-icon status-running"><Play aria-hidden="true" /></span><span className="transcoding-file-copy"><strong className="transcoding-file-name" title="/media/Naturefilm_4K.mkv">Naturefilm_4K.mkv</strong><span className="transcoding-file-meta">Movies · Storage profile</span></span></td>
                          <td className="transcoding-target-cell"><strong>H.265 / HEVC</strong><span>3840×2160 · MKV · HDR10</span></td>
                          <td className="transcoding-hardware-cell"><span className="transcoding-hardware-main"><span className="transcoding-hardware-dot status-available" /><strong>NVIDIA RTX 3080</strong></span><span>NVENC · hardware encoder</span></td>
                          <td className="transcoding-progress-cell"><div className="transcoding-progress-summary is-running"><div className="transcoding-progress-metrics"><div className="transcoding-progress-metric"><strong>64%</strong><span>Progress</span></div><div className="transcoding-progress-metric"><strong>12 min</strong><span>Time left</span></div><div className="transcoding-progress-metric is-accent"><strong>3.2×</strong><span>Speed</span></div></div><div className="transcoding-progress-chart"><Gauge aria-hidden="true" /></div><span className="transcoding-progress-track"><span style={{ width: "64%" }} /></span></div></td>
                          <td className="transcoding-actions-cell"><button type="button" className="secondary icon-only-button transcoding-job-action" aria-label="Stop"><Square aria-hidden="true" /></button><a href="#" className="secondary icon-only-button transcoding-job-action" aria-label="Open source file" title="Open source file"><SquareArrowOutUpRight aria-hidden="true" /></a></td>
                        </tr>
                        <tr className="transcoding-job-detail-row status-running"><td colSpan={5}><div className="transcoding-job-detail-grid"><div className="transcoding-job-detail-path"><div className="transcoding-job-paths"><span title="/media/Naturefilm_4K.mkv">Naturefilm_4K.mkv</span><span aria-hidden="true">↓</span><span title="/Transcode_Output/Naturefilm_4K.hevc.mkv">Naturefilm_4K.hevc.mkv</span></div><dl className="transcoding-job-transform-list"><div><dt>Codec</dt><dd><span>H.264 / AVC</span><span className="transcoding-transform-arrow" aria-hidden="true">→</span><span>H.265 / HEVC</span></dd></div><div><dt>Dynamic range</dt><dd><span>SDR</span><span className="transcoding-transform-arrow" aria-hidden="true">→</span><span>HDR10</span></dd></div></dl></div><div className="transcoding-job-detail-time"><dl className="transcoding-job-detail-list"><div><dt>Start time</dt><dd>Sep 7, 2026, 12:00 PM</dd></div><div><dt>Duration so far</dt><dd>28 min</dd></div><div><dt>ETA</dt><dd>12 min</dd></div></dl></div><div className="transcoding-job-detail-side"><span className="transcoding-hardware-availability status-available"><span className="transcoding-hardware-dot" />Available</span><span className="transcoding-detail-muted">Required: NVENC (HEVC)</span></div></div><div className="transcoding-job-detail-footer"><details className="transcoding-job-command"><summary>FFmpeg log</summary><code>ffmpeg -i Naturefilm_4K.mkv -c:v hevc_nvenc Naturefilm_4K.hevc.mkv</code></details><div className="transcoding-detail-links"><a href="#"><SquareArrowOutUpRight aria-hidden="true" />Open result</a></div></div></td></tr>
                      </tbody>
                    </table>
                  </div>
                </div>
              </VariantCard>
              <VariantCard title="Recent scan log card" source={`${settings} > Scan logs`} classes={["scan-log-card", "scan-log-summary", "scan-log-detail-section"]} wide>
                <ScanLogFixture />
              </VariantCard>
              <VariantCard title="Scan badges and outcomes" source={`${scanLogs} > Recent scans`} classes={["scan-badge", "scan-log-outcome", "badge-successful"]}>
                <div className="ui-elements-badge-row">
                  <Badge className="badge scan-log-outcome badge-successful">Successful</Badge>
                  <Badge className="badge scan-log-outcome badge-completed_with_issues">Completed with issues</Badge>
                  <Badge className="badge scan-log-outcome badge-failed">Failed</Badge>
                  <Badge className="badge scan-log-outcome badge-canceled">Canceled</Badge>
                </div>
              </VariantCard>
            </VariantGroup>
          </CatalogSection>

          <CatalogSection definition={catalogSections[9]}>
            <VariantGroup title="Library and file detail variants">
              <VariantCard title="Storage map explorer" source="StorageMapPage" classes={["storage-map-explorer", "storage-map-toolbar", "storage-map-treemap", "storage-map-tile", "storage-map-tile-tooltip", "settings-choice-input"]} wide>
                <div className="storage-map-panel">
                  <div className="storage-map-header">
                    <div className="storage-map-title-block">
                      <h2>Storage Map</h2>
                      <p className="subtitle">Every folder and file at a glance. Tile area corresponds to actual storage use.</p>
                    </div>
                    <div className="card-grid grid storage-map-header-cards">
                      <StatCard label="Storage" value="12.8 TB" tone="blue" />
                      <StatCard label="Files" value="1,842" tone="teal" />
                    </div>
                  </div>
                  <div className="storage-map-explorer" style={{ minHeight: 340 }}>
                    <div className="storage-map-content">
                      <div className="storage-map-breadcrumb-row">
                        <nav className="storage-map-breadcrumbs" aria-label="Current storage map folder">
                          <span><button type="button">Movies 4K</button></span>
                          <span><ChevronRight aria-hidden="true" /><button type="button">Feature Films</button></span>
                        </nav>
                      </div>
                      <div className="storage-map-toolbar">
                        <label className="storage-map-field storage-map-library-field">
                          <span>Library</span>
                          <select className="settings-choice-input" defaultValue="movies">
                            <option value="movies">Movies 4K</option>
                          </select>
                        </label>
                        <label className="storage-map-field">
                          <span>Color</span>
                          <select className="settings-choice-input" defaultValue="quality">
                            <optgroup label="Video">
                              <option value="codec">Video codec</option>
                              <option value="resolution">Resolution</option>
                              <option value="hdr">Dynamic range</option>
                              <option value="frame_rate">Frame rate</option>
                              <option value="bit_depth">Video bit depth</option>
                            </optgroup>
                            <optgroup label="Audio">
                              <option value="audio_codec">Audio codec</option>
                              <option value="audio_channels">Audio channels</option>
                              <option value="audio_bitrate">Audio bitrate</option>
                              <option value="audio_language">Audio language</option>
                            </optgroup>
                            <optgroup label="Subtitles">
                              <option value="subtitle_status">Subtitle availability</option>
                              <option value="subtitle_language">Subtitle language</option>
                            </optgroup>
                            <optgroup label="File">
                              <option value="container">Container</option>
                              <option value="size">File size</option>
                              <option value="duration">Duration</option>
                              <option value="bitrate">Overall bitrate</option>
                              <option value="quality">Quality score</option>
                              <option value="analysis_status">Analysis status</option>
                            </optgroup>
                          </select>
                        </label>
                        <label className="storage-map-field">
                          <span>Order</span>
                          <select className="settings-choice-input" defaultValue="size">
                            <option value="size">Size</option>
                          </select>
                        </label>
                        <div className="distribution-chart-mode-toggle analyzed-file-name-source-toggle storage-map-name-source-toggle" role="group" aria-label="Displayed file name">
                          <SlidingTogglePill activeKey="jellyfin" className="nav-active-pill distribution-chart-mode-pill" />
                          <button type="button" data-toggle-key="file" className="distribution-chart-mode-button analyzed-file-name-source-button" aria-label="Show file names">
                            <span className="distribution-chart-mode-button-content"><FileText aria-hidden="true" className="distribution-chart-mode-icon" /></span>
                          </button>
                          <button type="button" data-toggle-key="jellyfin" className="distribution-chart-mode-button analyzed-file-name-source-button active" aria-label="Show Jellyfin names">
                            <span className="distribution-chart-mode-button-content"><JellyfinIcon aria-hidden="true" className="distribution-chart-mode-icon" /></span>
                          </button>
                        </div>
                        <span className="storage-map-area-hint"><Info aria-hidden="true" />Area = storage used</span>
                      </div>
                      <div className="storage-map-stage has-up-overlay" style={{ minHeight: 250 }}>
                        <button
                          type="button"
                          aria-label="Up one level"
                          className="secondary icon-only-button storage-map-up-button storage-map-up-overlay"
                        >
                          <ArrowUp aria-hidden="true" />
                        </button>
                        <div className="storage-map-treemap">
                          <TooltipTrigger
                            ariaLabel="Open folder Feature Films, 4.2 TB"
                            className="storage-map-tile storage-map-tile-folder"
                            tooltipClassName="storage-map-tile-tooltip"
                            hoverOpenDelay={80}
                            maxWidth={360}
                            placement="auto"
                            pinOnClick={false}
                            style={{
                              left: 0,
                              top: 0,
                              width: "62%",
                              height: "100%",
                              backgroundColor: "#1b998b",
                            }}
                            content={(
                              <div className="storage-map-tile-tooltip-content">
                                <div className="storage-map-tile-tooltip-heading">
                                  <span className="storage-map-tile-tooltip-icon" aria-hidden="true"><Folder /></span>
                                  <span><strong>Feature Films</strong><small>Folders</small></span>
                                </div>
                                <span className="storage-map-tile-tooltip-metric">Quality score · 9/10</span>
                                <dl>
                                  <div><dt>Storage</dt><dd>4.2 TB</dd></div>
                                  <div><dt>Files</dt><dd>426</dd></div>
                                  <div><dt>Resolution</dt><dd>3840 × 2160</dd></div>
                                </dl>
                              </div>
                            )}
                          >
                            <span
                              className="storage-map-tile-color-field"
                              aria-hidden="true"
                              style={{
                                backgroundImage: [
                                  "radial-gradient(ellipse 45% 45% at 50% 76%, hsl(116 48% 39%) 0%, transparent 78%)",
                                  "radial-gradient(ellipse 54% 43% at 70% 40%, hsl(137 48% 38%) 0%, transparent 78%)",
                                  "radial-gradient(ellipse 43% 54% at 32% 34%, hsl(156 48% 36%) 0%, transparent 78%)",
                                  "radial-gradient(ellipse 65% 56% at 0% 100%, hsl(147 48% 37%) 0%, transparent 78%)",
                                  "radial-gradient(ellipse 56% 65% at 100% 100%, hsl(137 48% 38%) 0%, transparent 78%)",
                                  "radial-gradient(ellipse 65% 56% at 100% 0%, hsl(156 48% 36%) 0%, transparent 78%)",
                                  "radial-gradient(ellipse 56% 65% at 0% 0%, hsl(147 48% 37%) 0%, transparent 78%)",
                                ].join(", "),
                              }}
                            />
                            <span className="storage-map-tile-copy" aria-hidden="true">
                              <span className="storage-map-tile-name"><Folder aria-hidden="true" /><strong>Feature Films</strong></span>
                              <span className="storage-map-tile-meta">9/10</span>
                              <span className="storage-map-tile-size">4.2 TB</span>
                            </span>
                          </TooltipTrigger>
                          <button type="button" className="tooltip-trigger storage-map-tile storage-map-tile-file" style={{ left: "62%", top: 0, width: "38%", height: "68%", background: "hsl(147 48% 37%)" }}>
                            <span className="storage-map-tile-copy" aria-hidden="true">
                              <span className="storage-map-tile-name"><FileVideo aria-hidden="true" /><strong>Free Solo.mkv</strong></span>
                              <span className="storage-map-tile-meta">9/10</span>
                              <span className="storage-map-tile-size">287 GB</span>
                            </span>
                          </button>
                          <button type="button" className="tooltip-trigger storage-map-tile storage-map-tile-file" aria-label="Small files" style={{ left: "62%", top: "68%", width: "38%", height: "32%", background: "hsl(116 48% 39%)" }}>
                            <span className="storage-map-tile-copy" aria-hidden="true">
                              <span className="storage-map-tile-name"><FileVideo aria-hidden="true" /><strong>A very long documentary filename that fades at the tile edge.mkv</strong></span>
                              <span className="storage-map-tile-meta">7/10</span>
                              <span className="storage-map-tile-size">94 GB</span>
                            </span>
                          </button>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </VariantCard>
              <VariantCard title="File detail navigation and badges" source={`${fileDetail} > Overview`} classes={["file-detail-layout", "file-detail-navigation-panel", "file-detail-badge-tooltip-trigger"]} wide>
                <FileDetailNavigationFixture />
              </VariantCard>
              <VariantCard title="Path segment trail" source={`${fileDetail} > Overview / Analyzed files`} classes={["path-segment-trail", "path-segment", "path-segment-leaf"]}>
                <PathSegmentTrail value="/media/Movies/Arrival/Arrival.2016.UHD.mkv" />
              </VariantCard>
              <VariantCard title="Preview and download warning" source={`${fileDetail} > Preview`} classes={["file-detail-preview-panel", "file-detail-preview-player", "file-detail-preview-report"]}>
                <PreviewFixture />
              </VariantCard>
              <VariantCard title="Stream details list" source={`${fileDetail} > Streams / Table tooltips`} classes={["stream-details-list", "stream-detail-entry", "stream-detail-entry-chevron", "stream-detail-entry-summary-value"]}>
                <div className="stack">
                  <AudioStreamPrimaryToggle mode={audioPrimaryMode} onChange={setAudioPrimaryMode} />
                  <StreamDetailsList kind="video" detail={streamDetails} t={t} surface="panel" showSummary inDepthDolbyVisionProfiles />
                </div>
              </VariantCard>
              <VariantCard title="Quality breakdown rows" source={`${fileDetail} > Quality score`} classes={["quality-detail-list", "quality-detail-entry", "stream-detail-entry-chevron", "stream-detail-entry-summary-value"]}>
                <div className="quality-tooltip-content quality-detail-list">
                  <div className="quality-tooltip-summary"><strong>9/10</strong><span>Raw: 91.20 / 100</span></div>
                  <details className="stream-detail-entry quality-detail-entry" open>
                    <summary className="stream-detail-entry-head quality-detail-entry-head">
                      <span className="stream-detail-entry-chevron" aria-hidden="true"><ChevronRight className="nav-icon" /></span>
                      <div className="stream-tooltip-inline"><strong>Resolution</strong><div className="stream-tooltip-meta"><span className="stream-tooltip-pill">Weight: 8</span></div></div>
                      <span className="stream-detail-entry-summary-value">92 / 100</span>
                    </summary>
                    <div className="stream-detail-entry-body"><div className="stream-detail-field"><span className="stream-detail-field-label">Actual</span><strong className="stream-detail-field-value">3840x2160</strong></div><div className="stream-detail-field"><span className="stream-detail-field-label">Ideal</span><strong className="stream-detail-field-value">4K</strong></div></div>
                  </details>
                  <details className="stream-detail-entry quality-detail-entry">
                    <summary className="stream-detail-entry-head quality-detail-entry-head">
                      <span className="stream-detail-entry-chevron" aria-hidden="true"><ChevronRight className="nav-icon" /></span>
                      <div className="stream-tooltip-inline"><strong>Audio codec</strong></div>
                      <span className="stream-detail-entry-summary-value">76 / 100</span>
                    </summary>
                  </details>
                </div>
              </VariantCard>
              <VariantCard title="File detail panel header actions" source={`${fileDetail} > Quality breakdown / Chapters`} classes={["async-panel-toggle-actions", "settings-panel-header-action", "file-detail-quality-export-button", "file-detail-chapter-summary", "file-detail-chapter-export-button"]}>
                <div className="stack">
                  <div className="panel-title-row">
                    <h2>Quality breakdown</h2>
                    <div className="async-panel-toggle-actions">
                      <button type="button" className="secondary small settings-panel-header-action file-detail-quality-export-button"><Download className="nav-icon" aria-hidden="true" />Export quality report (CSV)</button>
                    </div>
                  </div>
                  <div className="stream-tooltip-content stream-tooltip-content-panel">
                    <div className="stream-tooltip-summary file-detail-chapter-summary">
                      <div className="file-detail-chapter-summary-copy"><strong>Chapters</strong><span>12</span></div>
                      <button type="button" className="secondary small settings-panel-header-action file-detail-chapter-export-button">Export chapters</button>
                    </div>
                    <div className="file-detail-chapter-tools"><input type="search" aria-label="Search chapters" placeholder="Search chapter titles" /></div>
                  </div>
                </div>
              </VariantCard>
              <VariantCard title="Multi-source connector playback in file details" source={`${fileDetail} > Overview / Streaming / Cover`} classes={["file-detail-overview", "format-details-content", "jellyfin-streaming-panel", "file-detail-streaming-availability-tooltip", "library-history-range-toggle", "library-history-range-custom-shell", "playback-history-display-control", "playback-history-display-heading", "playback-history-data-summary", "playback-history-timeline-axis", "playback-history-availability-boundary", "playback-history-availability-note", "playback-history-search", "playback-history-timestamp", "playback-history-undated", "playback-history-undated-list", "playback-history-display-toggle", "playback-history-export-button", "file-detail-cover-comparison"]} wide>
                <div className="file-detail-overview">
                  <div className="file-detail-title-row"><h3 className="file-detail-title">Arrival.2016.mkv</h3></div>
                  <div className="meta-tags file-detail-overview-badges"><span className="badge">HEVC</span><span className="badge">UHD</span><div className="jellyfin-overview-badge-group is-separated"><span className="badge"><Server aria-hidden="true" />Jellyfin</span><span className="badge">Movie</span></div></div>
                  <div className="stream-tooltip-content stream-tooltip-content-panel format-details-content"><div className="stream-tooltip-row"><div className="stream-tooltip-head format-details-row"><span className="format-details-label">Container</span><strong className="format-details-value">Matroska</strong></div></div><div className="stream-tooltip-row"><div className="stream-tooltip-head format-details-row"><span className="format-details-label">Size</span><strong className="format-details-value">10.7 GB</strong></div></div></div>
                  <div className="file-detail-jellyfin-overview"><div className="jellyfin-overview-details"><div className="stream-tooltip-content stream-tooltip-content-panel format-details-content"><div className="stream-tooltip-row"><div className="stream-tooltip-head format-details-row"><span className="format-details-label">Production year</span><strong className="format-details-value">2016</strong></div></div></div><p className="jellyfin-overview">Jellyfin catalog metadata is shown alongside the technical analysis.</p></div></div>
                  <div className="panel-title-row">
                    <h2>Streaming</h2>
                    <TooltipTrigger
                      className="file-detail-streaming-availability-tooltip"
                      ariaLabel="Explain individual playback availability"
                      content="Jellyfin retains individual playback starts for a limited history. The exact synchronized boundary is marked on the timeline."
                    />
                  </div>
                  <div className="jellyfin-file-panel jellyfin-streaming-panel">
                    <ConnectorStreamingDetails
                      durationSeconds={7198}
                      sources={[
                        { connection_id: 1, connection_name: "Living Room", provider: "jellyfin", connector_item_id: 10, user_data: [{ remote_user_id: "frederik", user_name: "Frederik", play_count: 2, played: true, playback_position_ticks: 0, last_played_date: "2026-07-27T20:41:13Z", is_favorite: false }], playback_events: [{ remote_event_id: "101", remote_user_id: "frederik", user_name: "Frederik", played_at: "2026-07-27T20:41:13Z" }, { remote_event_id: "100", remote_user_id: "frederik", user_name: "Frederik", played_at: "2026-07-27T20:18:07Z" }], individual_playback_history_start_at: "2026-07-19T14:44:02Z" },
                        { connection_id: 2, connection_name: "Archive", provider: "jellyfin", connector_item_id: 22, user_data: [{ remote_user_id: "frederik", user_name: "Frederik", play_count: 1, played: false, playback_position_ticks: 13510000000, last_played_date: "2026-07-24T17:58:50Z", is_favorite: false }], playback_events: [{ remote_event_id: "101", remote_user_id: "frederik", user_name: "Frederik", played_at: "2026-07-24T17:58:50Z" }], individual_playback_history_start_at: "2026-07-20T09:00:00Z" },
                      ]}
                      showAllPlaybacksWhenUnstacked
                    />
                  </div>
                </div>
              </VariantCard>
              <VariantCard title="Favorite compatibility groups" source={`${fileDetail} > Compatibility`} classes={["compatibility-favorite-sections", "compatibility-favorite-section", "compatibility-profile-report"]} wide>
                <div className="stack">
                  <div className="panel-title-row">
                    <h2>Compatibility</h2>
                    <TooltipTrigger
                      ariaLabel="Show compatibility favorites help"
                      content={(
                        <div className="file-detail-compatibility-help-content">
                          <span>Click a section&apos;s search field to show all profiles. Favorites stay at the top and are evaluated here.</span>
                          <a href="/settings">Open Hard/Software Profiles</a>
                        </div>
                      )}
                    >
                      <Info size={14} aria-hidden="true" />
                    </TooltipTrigger>
                  </div>
                  <div className="compatibility-favorite-sections">
                  <details className="compatibility-favorite-section" open>
                    <summary>
                      <span className="compatibility-favorite-section-chevron" aria-hidden="true"><ChevronRight className="nav-icon" /></span>
                      <span className="compatibility-favorite-section-label">Hardware</span>
                      <span className="compatibility-favorite-count">1</span>
                    </summary>
                    <div className="compatibility-favorite-section-body">
                      <div className="compatibility-profile-search">
                        <Search size={16} aria-hidden="true" className="compatibility-profile-search-icon" />
                        <input aria-label="Search Hardware profiles" placeholder="Search profiles" type="search" />
                      </div>
                      <details className="compatibility-favorite-profile" open>
                        <summary className="compatibility-favorite-profile-summary">
                          <span className="compatibility-favorite-profile-chevron" aria-hidden="true"><ChevronRight className="nav-icon" /></span>
                          <span className="compatibility-favorite-profile-name">Apple TV 4K 3rd Gen</span>
                          <span className="compatibility-favorite-profile-actions">
                            <span className="compatibility-status-badge status-direct_play">Direct play</span>
                            <span className="compatibility-profile-quick-actions">
                              <ProfileFavoriteButton
                                favorite
                                label="Remove Apple TV 4K 3rd Gen from favorites"
                                onClick={() => undefined}
                              />
                            </span>
                          </span>
                        </summary>
                        <div className="compatibility-favorite-profile-report">
                          <div className="compatibility-profile-report status-direct_play">
                            <div className="stream-tooltip-meta">
                              <span className="stream-tooltip-pill compatibility-scope-pill status-direct_play">Container: Direct play</span>
                              <span className="stream-tooltip-pill compatibility-scope-pill status-direct_play">Audio: Direct play</span>
                            </div>
                            <div className="notice">No compatibility issues detected.</div>
                          </div>
                        </div>
                      </details>
                    </div>
                  </details>
                  <details className="compatibility-favorite-section" open>
                    <summary>
                      <span className="compatibility-favorite-section-chevron" aria-hidden="true"><ChevronRight className="nav-icon" /></span>
                      <span className="compatibility-favorite-section-label">Software / Player</span>
                      <span className="compatibility-favorite-count">1</span>
                    </summary>
                  </details>
                  <details className="compatibility-favorite-section" open>
                    <summary>
                      <span className="compatibility-favorite-section-chevron" aria-hidden="true"><ChevronRight className="nav-icon" /></span>
                      <span className="compatibility-favorite-section-label">Combination</span>
                      <span className="compatibility-favorite-count">1</span>
                    </summary>
                  </details>
                  </div>
                </div>
              </VariantCard>
            </VariantGroup>
          </CatalogSection>

          <CatalogSection definition={catalogSections[10]}>
            <VariantGroup title="Duplicates, paths, telemetry">
              <VariantCard title="Duplicate group cards" source={`${libraryDetail} > Duplicates`} classes={["duplicate-group-card", "duplicate-group-item-card", "duplicate-group-action"]} wide>
                <div className="duplicate-group-list">
                  <DuplicateGroupFixture />
                  <DuplicateGroupFixture suppressed />
                </div>
              </VariantCard>
              <VariantCard title="File comparison rows" source="FileComparePage" classes={["file-compare-search-card", "file-compare-row", "has-difference", "is-identical"]} wide>
                <div className="file-compare-page">
                  <div className="panel-title-row panel-title-row-with-actions">
                    <div className="file-compare-title-block">
                      <h2>Compare files</h2>
                      <p className="subtitle">Place two analyzed media files side by side and highlight metadata differences.</p>
                    </div>
                    <div className="file-compare-title-actions">
                      <div className="search-filter-picker file-compare-column-count-picker">
                        <button type="button" className="file-compare-column-count-button is-open" aria-label="Select comparison columns" aria-expanded="true" title="Select comparison columns">
                          <Columns3Cog size={20} aria-hidden="true" />
                        </button>
                        <div className="search-filter-picker-popover file-compare-column-count-popover" role="menu">
                          <button type="button" className="search-filter-picker-item is-selected" role="menuitemradio" aria-checked="true">
                            <Columns3 size={16} aria-hidden="true" />
                            <span>3 columns</span>
                          </button>
                        </div>
                      </div>
                    </div>
                  </div>
                  <div className="file-compare-toolbar file-compare-toolbar-3-columns has-file-labels">
                    <div className="file-compare-toolbar-controls">
                      <div className="distribution-chart-mode-toggle duplicate-panel-view-toggle file-compare-display-toggle" role="group" aria-label="Select compare display">
                        <SlidingTogglePill activeKey="all" className="nav-active-pill distribution-chart-mode-pill" />
                        <button type="button" data-toggle-key="all" className="distribution-chart-mode-button duplicate-panel-view-button file-compare-display-button active" aria-label="Show all categories, metadata, and metrics" title="Show all categories, metadata, and metrics">
                          <span className="distribution-chart-mode-button-content">
                            <Layers aria-hidden="true" className="distribution-chart-mode-icon" />
                          </span>
                        </button>
                        <button type="button" data-toggle-key="differences" className="distribution-chart-mode-button duplicate-panel-view-button file-compare-display-button" aria-label="Show differences only" title="Show differences only">
                          <span className="distribution-chart-mode-button-content">
                            <Diff aria-hidden="true" className="distribution-chart-mode-icon" />
                          </span>
                        </button>
                      </div>
                    </div>
                    <div className="file-compare-search-card">
                      <div className="file-compare-search-label">
                        <strong title="Movies / Sci-Fi/Arrival.2016.UHD.mkv">Arrival.2016.UHD.mkv</strong>
                        <button type="button" className="file-compare-clear-file-button" aria-label="Remove Arrival.2016.UHD.mkv from comparison" title="Remove Arrival.2016.UHD.mkv from comparison">
                          <DeleteIcon size={16} aria-hidden="true" />
                        </button>
                      </div>
                      <div className="metadata-search-control metadata-search-control-base search-filter-picker file-compare-search-control">
                        <button type="button" className="search-filter-picker-button" aria-label="Filter library"><ListFilter size={18} /></button>
                        <input type="search" placeholder="Search filename or path" aria-label="Search left file" />
                      </div>
                      <div className="file-compare-search-results">
                        <button type="button" className="file-compare-search-result is-disabled" disabled title="Already selected on the other side.">
                          <span className="file-compare-search-result-main" title="Movies / Sci-Fi/Arrival.2016.Remux.mkv">Arrival.2016.Remux.mkv</span>
                          <span className="file-compare-search-result-meta">21.1 GB - Video - Movies</span>
                        </button>
                      </div>
                    </div>
                    <button
                      type="button"
                      className="file-compare-swap-button"
                      aria-label="Swap compared files"
                      title="Swap compared files"
                    >
                      <ChevronsRightLeftIcon size={22} aria-hidden="true" />
                    </button>
                    <div className="file-compare-search-card">
                      <div className="file-compare-search-label">
                        <strong title="Movies / Sci-Fi/Arrival.2016.Remux.mkv">Arrival.2016.Remux.mkv</strong>
                        <button type="button" className="file-compare-clear-file-button" aria-label="Remove Arrival.2016.Remux.mkv from comparison" title="Remove Arrival.2016.Remux.mkv from comparison">
                          <DeleteIcon size={16} aria-hidden="true" />
                        </button>
                      </div>
                      <div className="metadata-search-control metadata-search-control-base search-filter-picker file-compare-search-control">
                        <button type="button" className="search-filter-picker-button is-open" aria-label="Filter library"><ListFilter size={18} /></button>
                        <input type="search" placeholder="Search filename or path" aria-label="Search right file" />
                      </div>
                    </div>
                    <div className="file-compare-search-card">
                      <div className="file-compare-search-label">
                        <strong title="Movies / Sci-Fi/Arrival.2016.HD.mkv">Arrival.2016.HD.mkv</strong>
                        <button type="button" className="file-compare-clear-file-button" aria-label="Remove Arrival.2016.HD.mkv from comparison" title="Remove Arrival.2016.HD.mkv from comparison">
                          <DeleteIcon size={16} aria-hidden="true" />
                        </button>
                      </div>
                      <div className="metadata-search-control metadata-search-control-base search-filter-picker file-compare-search-control">
                        <button type="button" className="search-filter-picker-button" aria-label="Filter library"><ListFilter size={18} /></button>
                        <input type="search" placeholder="Search filename or path" aria-label="Search third file" />
                      </div>
                    </div>
                  </div>
                  <section className="panel file-compare-section">
                    <button type="button" className="file-compare-section-toggle" aria-expanded="true">
                      <span className="file-compare-section-title">
                        <FileDiff size={18} />
                        Overview
                        <span className="badge file-compare-section-diff-badge" aria-label="2 changed" title="2 changed">
                          <Diff size={14} aria-hidden="true" />
                          <span>2</span>
                        </span>
                      </span>
                      <ChevronDown size={18} />
                    </button>
                    <div className="file-compare-row-list">
                      <div className="file-compare-row has-difference" style={{ "--file-compare-value-columns": 3 } as React.CSSProperties}>
                        <div className="file-compare-row-label">Size</div>
                        <div className="file-compare-cell">18.4 GB</div>
                        <div className="file-compare-cell">21.1 GB</div>
                        <div className="file-compare-cell">8.6 GB</div>
                      </div>
                      <div className="file-compare-row is-identical" style={{ "--file-compare-value-columns": 3 } as React.CSSProperties}>
                        <div className="file-compare-row-label">Resolution</div>
                        <div className="file-compare-cell">3840x2160</div>
                        <div className="file-compare-cell">3840x2160</div>
                        <div className="file-compare-cell">3840x2160</div>
                      </div>
                    </div>
                  </section>
                  <section className="panel file-compare-section">
                    <button type="button" className="file-compare-section-toggle" aria-expanded="false">
                      <span className="file-compare-section-title">
                        <AudioLines size={18} />
                        Audio streams
                      </span>
                      <ChevronRight size={18} />
                    </button>
                  </section>
                </div>
              </VariantCard>
              <VariantCard title="Compact transcoding plan" source="TranscodingPanel" classes={["transcoding-panel", "transcode-control", "settings-choice-input", "transcode-progress", "transcode-progress-compact", "transcode-progress-compact-content", "transcode-progress-center-link", "transcode-progress-actions", "transcoding-progress-summary", "transcoding-progress-metrics", "transcoding-progress-metric", "transcoding-progress-chart", "transcoding-progress-meta", "transcode-stream-tabs", "transcode-stream-tab", "transcode-stream-tab-count", "transcode-stream-tabpanel", "transcode-stream-list", "transcode-stream-list-item", "transcode-stream-list-row", "transcode-stream-row-trigger", "transcode-stream-row-copy", "transcode-stream-action-icon", "transcode-action-field", "transcode-action-select", "transcode-stream-details", "transcode-stream-copy-details", "transcode-stream-copy-note", "transcode-stream-encode-fields", "transcode-video-encode-fields", "transcode-control-field", "transcode-dynamic-range-field", "transcode-codec-field", "transcode-preset-field", "transcode-range-row", "transcode-quality-range", "transcode-range-value", "transcode-filename-section", "transcode-filename-header", "transcode-filename-toggle", "transcode-filename-chevron", "transcode-filename-body", "transcode-filename-template-input", "transcode-filename-template-editor", "transcode-filename-inline-token", "transcode-filename-inline-text", "transcode-filename-metadata-tools", "transcode-filename-metadata-toggle", "transcode-filename-token-list", "transcode-filename-token-pill", "transcode-filename-options-row", "transcode-filename-divider-field", "transcode-filename-cleanup", "transcode-filename-cleanup-heading", "transcode-filename-cleanup-control", "transcode-filename-field", "transcode-filename-preview", "transcode-action-button"]} wide>
                <div className="transcoding-panel">
                  <div className="transcode-configuration-grid">
                    <label><span>Profile</span><select className="settings-choice-input transcode-control" defaultValue="compatibility"><option value="compatibility">Original / copy</option></select></label>
                    <label><span>Target container</span><select className="settings-choice-input transcode-control" defaultValue="mp4"><option value="mp4">MP4</option></select></label>
                    <label><span>Output mode</span><select className="settings-choice-input transcode-control" title="Separate output works with a read-only media mount; same-directory and replacement require a writable media directory." defaultValue="transcode_output"><option value="transcode_output">Separate Transcode_Output</option><option value="same_directory">Next to source file</option><option value="replace_original">Replace original</option></select></label>
                    <label><span>Execution target</span><select className="settings-choice-input transcode-control" title="Execution target: local. Automatic mode includes queueing, transfer, transcoding and result publishing." defaultValue="local"><option value="local">This installation</option><option value="automatic">Automatic federation worker</option></select></label>
                  </div>
                  <section className="transcode-progress transcode-progress-compact" aria-live="polite">
                    <div className="transcode-progress-compact-content">
                      <div className="transcoding-progress-summary is-running is-compact"><div className="transcoding-progress-metrics"><div className="transcoding-progress-metric"><strong>64%</strong><span>Progress</span></div><div className="transcoding-progress-metric"><strong>12 min</strong><span>Time left</span></div><div className="transcoding-progress-metric is-accent"><strong>3.2×</strong><span>Speed</span></div></div><div className="transcoding-progress-chart"><Gauge aria-hidden="true" /></div><span className="transcoding-progress-track"><span style={{ width: "64%" }} /></span><div className="transcoding-progress-meta"><span className="transcoding-progress-phase">Transcoding</span><span className="transcoding-progress-transfer">1.2 GB / 2.0 GB</span></div></div>
                      <a className="secondary small transcode-progress-center-link" href="#"><SquareArrowOutUpRight aria-hidden="true" />Open transcoding center</a>
                    </div>
                    <div className="transcode-progress-actions"><button type="button" className="secondary danger"><Square aria-hidden="true" />Cancel</button></div>
                  </section>
                  <div className="transcode-automation-tab-controls transcode-stream-tabs">
                    <div className="transcode-automation-tab-list" role="tablist" aria-label="Stream types" aria-orientation="horizontal">
                      <button type="button" id="catalog-transcode-stream-tab-video" className="transcode-automation-tab-button transcode-stream-tab active" role="tab" aria-selected="true" aria-controls="catalog-transcode-stream-panel-video"><Film aria-hidden="true" size={16} /><span className="transcode-automation-tab-label">Video</span><span className="transcode-stream-tab-count">6</span></button>
                      <button type="button" id="catalog-transcode-stream-tab-audio" className="transcode-automation-tab-button transcode-stream-tab" role="tab" aria-selected="false" aria-controls="catalog-transcode-stream-panel-audio" tabIndex={-1}><AudioLines aria-hidden="true" size={16} /><span className="transcode-automation-tab-label">Audio</span><span className="transcode-stream-tab-count">2</span></button>
                      <button type="button" id="catalog-transcode-stream-tab-subtitles" className="transcode-automation-tab-button transcode-stream-tab" role="tab" aria-selected="false" aria-controls="catalog-transcode-stream-panel-subtitles" tabIndex={-1}><Captions aria-hidden="true" size={16} /><span className="transcode-automation-tab-label">Subtitles</span><span className="transcode-stream-tab-count">1</span></button>
                    </div>
                  </div>
                  <div id="catalog-transcode-stream-panel-video" className="transcode-stream-tabpanel" role="tabpanel" aria-labelledby="catalog-transcode-stream-tab-video">
                    <div className="transcode-stream-list">
                      <article className="transcode-stream-list-item is-expanded">
                        <div className="transcode-stream-list-row">
                          <button type="button" className="transcode-stream-row-trigger" aria-expanded="true" aria-controls="catalog-transcode-stream-details-video-0"><span className="transcode-stream-row-copy"><strong>#0</strong><span>HEVC</span><span className="transcode-language-badge">Undetermined</span></span><ChevronDown aria-hidden="true" /></button>
                          <div className="transcode-action-field is-expanded" data-action="encode"><RefreshCw aria-hidden="true" className="transcode-stream-action-icon" /><select className="settings-choice-input transcode-control transcode-action-select" aria-label="Action for stream 0" title="Copy keeps the source stream unchanged. Encode converts it with the selected controls. Remove excludes it from the output." defaultValue="encode"><option value="copy">Copy</option><option value="encode">Encode</option><option value="drop">Remove</option></select></div>
                        </div>
                        <div id="catalog-transcode-stream-details-video-0" className="transcode-stream-details">
                          <div className="transcode-stream-encode-fields transcode-video-encode-fields">
                            <label className="transcode-control-field transcode-dynamic-range-field"><span className="transcode-field-label"><span>Dynamic range</span></span><select className="settings-choice-input transcode-control" defaultValue="preserve"><option value="preserve">Preserve</option><option value="sdr">SDR</option><option value="hdr10">HDR10</option><option value="hlg">HLG</option></select></label>
                            <label className="transcode-control-field transcode-codec-field"><span className="transcode-field-label"><span>Target codec</span><TooltipTrigger ariaLabel="Explain automatic encoder selection" content="The target worker chooses a compatible encoder for this codec and its available hardware device automatically." /></span><select className="settings-choice-input transcode-control" defaultValue="hevc"><option value="h264">H.264 / AVC</option><option value="hevc">H.265 / HEVC</option><option value="av1">AV1</option></select></label>
                            <label className="transcode-control-field"><span className="transcode-field-label"><span>Quality (ICQ)</span><TooltipTrigger ariaLabel="Explain quality control" content="Lower values mean higher quality for Intel QSV's constant-quality mode." /></span><span className="transcode-range-row"><input className="settings-choice-input transcode-control transcode-quality-range is-reversed" type="range" min="1" max="51" defaultValue="23" /><input className="settings-choice-input transcode-control transcode-range-value" type="number" min="1" max="51" defaultValue="23" aria-label="video 0 quality value" /></span></label>
                            <label className="transcode-control-field transcode-preset-field"><span className="transcode-field-label"><span>Speed preset</span><TooltipTrigger ariaLabel="Explain encoding speed preset" content="Faster presets reduce encoding time but usually reduce compression efficiency and increase file size." /></span><select className="settings-choice-input transcode-control" defaultValue="medium"><option value="veryfast">veryfast · Very fast</option><option value="fast">fast · Fast</option><option value="medium">medium · Balanced</option><option value="slow">slow · Slow</option><option value="veryslow">veryslow · Very slow</option></select></label>
                            <label className="transcode-control-field"><span className="transcode-field-label"><span>Output resolution</span><TooltipTrigger ariaLabel="Explain output resolution" content="Only equal or lower heights are offered." /></span><select className="settings-choice-input transcode-control" defaultValue="1920x1080"><option value="1920x1080">1080p (1920×1080)</option></select></label>
                          </div>
                        </div>
                      </article>
                      <article className="transcode-stream-list-item"><div className="transcode-stream-list-row"><button type="button" className="transcode-stream-row-trigger" aria-expanded="false"><span className="transcode-stream-row-copy"><strong>#1</strong><span>H.264 / AVC</span></span><ChevronDown aria-hidden="true" /></button><div className="transcode-action-field is-collapsed" data-action="copy"><Copy aria-hidden="true" className="transcode-stream-action-icon" /><select className="settings-choice-input transcode-control transcode-action-select" aria-label="Action for stream 1" title="Copy keeps the source stream unchanged. Encode converts it with the selected controls. Remove excludes it from the output." defaultValue="copy"><option value="copy">Copy</option><option value="encode">Encode</option><option value="drop">Remove</option></select></div></div></article>
                      <article className="transcode-stream-list-item"><div className="transcode-stream-list-row"><button type="button" className="transcode-stream-row-trigger" aria-expanded="false"><span className="transcode-stream-row-copy"><strong>#2</strong><span>AV1</span></span><ChevronDown aria-hidden="true" /></button><div className="transcode-action-field is-collapsed" data-action="encode"><RefreshCw aria-hidden="true" className="transcode-stream-action-icon" /><select className="settings-choice-input transcode-control transcode-action-select" aria-label="Action for stream 2" title="Copy keeps the source stream unchanged. Encode converts it with the selected controls. Remove excludes it from the output." defaultValue="encode"><option value="copy">Copy</option><option value="encode">Encode</option><option value="drop">Remove</option></select></div></div></article>
                      <article className="transcode-stream-list-item"><div className="transcode-stream-list-row"><button type="button" className="transcode-stream-row-trigger" aria-expanded="false"><span className="transcode-stream-row-copy"><strong>#3</strong><span>HEVC</span></span><ChevronDown aria-hidden="true" /></button><div className="transcode-action-field is-collapsed" data-action="drop"><Trash2 aria-hidden="true" className="transcode-stream-action-icon" /><select className="settings-choice-input transcode-control transcode-action-select" aria-label="Action for stream 3" title="Copy keeps the source stream unchanged. Encode converts it with the selected controls. Remove excludes it from the output." defaultValue="drop"><option value="copy">Copy</option><option value="encode">Encode</option><option value="drop">Remove</option></select></div></div></article>
                      <article className="transcode-stream-list-item"><div className="transcode-stream-list-row"><button type="button" className="transcode-stream-row-trigger" aria-expanded="false"><span className="transcode-stream-row-copy"><strong>#4</strong><span>MPEG-2</span></span><ChevronDown aria-hidden="true" /></button><div className="transcode-action-field is-collapsed" data-action="copy"><Copy aria-hidden="true" className="transcode-stream-action-icon" /><select className="settings-choice-input transcode-control transcode-action-select" aria-label="Action for stream 4" title="Copy keeps the source stream unchanged. Encode converts it with the selected controls. Remove excludes it from the output." defaultValue="copy"><option value="copy">Copy</option><option value="encode">Encode</option><option value="drop">Remove</option></select></div></div></article>
                      <article className="transcode-stream-list-item"><div className="transcode-stream-list-row"><button type="button" className="transcode-stream-row-trigger" aria-expanded="false"><span className="transcode-stream-row-copy"><strong>#5</strong><span>MJPEG</span></span><ChevronDown aria-hidden="true" /></button><div className="transcode-action-field is-collapsed" data-action="copy"><Copy aria-hidden="true" className="transcode-stream-action-icon" /><select className="settings-choice-input transcode-control transcode-action-select" aria-label="Action for stream 5" title="Copy keeps the source stream unchanged. Encode converts it with the selected controls. Remove excludes it from the output." defaultValue="copy"><option value="copy">Copy</option><option value="encode">Encode</option><option value="drop">Remove</option></select></div></div></article>
                    </div>
                  </div>
                  <section className="media-card library-settings-card transcode-filename-section is-expanded">
                    <header className="transcode-filename-header"><button type="button" className="transcode-filename-toggle" aria-expanded="true" aria-controls="catalog-transcode-filename"><span className="transcode-filename-chevron" aria-hidden="true"><ChevronDown className="nav-icon" /></span><span className="transcode-filename-heading"><h3>Filename template</h3></span></button><TooltipTrigger ariaLabel="Explain filename template" content="Use tokens in braces and optional groups in square brackets." /></header>
                    <div className="transcode-filename-body" id="catalog-transcode-filename">
                      <div className="settings-choice-input transcode-control transcode-filename-template-input transcode-filename-template-editor" contentEditable role="textbox" aria-label="Filename template" aria-multiline="false" suppressContentEditableWarning>
                        <span className="transcode-filename-inline-text">[</span><span className="transcode-filename-inline-token" contentEditable={false} data-filename-token="resolution">{'{resolution}'}</span><span className="transcode-filename-inline-text">, </span><span className="transcode-filename-inline-token" contentEditable={false} data-filename-token="dynRange">{'{dynRange}'}</span><span className="transcode-filename-inline-text">, </span><span className="transcode-filename-inline-token" contentEditable={false} data-filename-token="codec">{'{codec}'}</span><span className="transcode-filename-inline-text">] [</span><span className="transcode-filename-inline-token" contentEditable={false} data-filename-token="audioLanguages">{'{audioLanguages}'}</span><span className="transcode-filename-inline-text">] [</span><span className="transcode-filename-inline-token" contentEditable={false} data-filename-token="subtitleLanguages">{'{subtitleLanguages}'}</span><span className="transcode-filename-inline-text">]</span>
                      </div>
                      <div className="transcode-filename-metadata-tools">
                        <button type="button" className="secondary small settings-panel-header-action transcode-filename-metadata-toggle" aria-expanded="false"><Plus aria-hidden="true" size={14} />Add metadata</button>
                      </div>
                       <div className="transcode-filename-options-row">
                         <label className="transcode-filename-field transcode-filename-divider-field"><span className="transcode-field-label"><span>Metadata divider</span><TooltipTrigger ariaLabel="Explain metadata divider" content="Separates multiple values from one metadata token, such as audio or subtitle languages." /></span><input className="settings-choice-input transcode-control" defaultValue=", " /></label>
                         <div className="transcode-filename-cleanup"><div className="transcode-filename-cleanup-heading"><h4>Source filename cleanup</h4><TooltipTrigger ariaLabel="Explain source filename cleanup" content="Presets use regular expressions; custom removes every match." /></div><label className="transcode-filename-field transcode-filename-cleanup-control"><span className="sr-only">Removal preset</span><select className="settings-choice-input transcode-control" defaultValue="square_brackets"><option value="none">Keep original filename</option><option value="square_brackets">Square brackets [ … ]</option><option value="custom">Custom regular expression</option></select></label></div>
                       </div>
                       <div className="transcode-filename-preview is-prominent"><span>Finished filename preview</span><code>Arrival [1920x1080, SDR, H264] [en] [de, fr].mp4</code></div>
                    </div>
                  </section>
                  <div className="transcode-actions"><button type="button" className="secondary transcode-action-button">✓ Validate plan</button><button type="button" className="transcode-action-button">Start transcoding</button></div>
                  <section className="transcode-validation is-valid"><h3><Check aria-hidden="true" />Change preview</h3><strong>Arrival [1920x1080, SDR, H264] [en].mp4</strong><code>ffmpeg -i Arrival.mkv -map 0:0 -c:v:0 libx264 …</code></section>
                </div>
              </VariantCard>
              <VariantCard title="Direct transcode federation pairing" source="TranscodeFederationPanel" classes={["transcode-federation-panel", "transcode-federation-heading", "transcode-federation-heading-main", "transcode-federation-section-chevron", "transcode-federation-installation", "transcode-federation-installation-name", "transcode-federation-name-action", "transcode-federation-heading-actions", "transcode-federation-code-summary", "transcode-federation-code-summary-label", "transcode-federation-header-code", "transcode-federation-content", "tooltip-trigger", "icon-only-button", "transcode-federation-code-action", "transcode-federation-code", "transcode-federation-code-progress", "transcode-federation-subheading", "transcode-federation-addresses", "transcode-federation-address-list", "transcode-federation-address-item", "transcode-federation-address-copy", "toggle-switch", "toggle-switch-track", "toggle-switch-thumb", "transcode-federation-toggle"]} wide>
                <section className="transcode-federation-panel">
                  <div className="transcode-federation-heading">
                    <div className="transcode-federation-heading-main">
                      <button type="button" className="transcode-federation-section-chevron" aria-label="Collapse Federation" title="Collapse Federation" aria-expanded="true" aria-controls="catalog-federation-body"><ChevronDown aria-hidden="true" className="nav-icon" /></button>
                      <label className="toggle-switch transcode-federation-toggle"><input type="checkbox" role="switch" defaultChecked aria-label="Enable direct federation for this installation" /><span className="toggle-switch-track" aria-hidden="true"><span className="toggle-switch-thumb" /></span></label>
                      <h3>Federation</h3>
                      <div className="transcode-federation-installation"><span className="transcode-federation-installation-name">Living room server</span><button type="button" className="secondary icon-only-button transcode-federation-name-action" aria-label="Edit: Installation name" title="Edit: Installation name"><SquarePenIcon aria-hidden="true" className="nav-icon" size={16} /></button></div>
                    </div>
                    <div className="transcode-federation-heading-actions">
                      <div className="transcode-federation-code-summary"><span className="transcode-federation-code-summary-label">Pairing code</span><div className="transcode-federation-address-item transcode-federation-code transcode-federation-header-code"><code title="048271" aria-label="Pairing code">048271</code><TooltipTrigger ariaLabel="Copy code" content="Copy code" className="secondary icon-only-button transcode-federation-address-copy" pinOnClick={false}><CopyIcon aria-hidden="true" className="nav-icon" size={15} /></TooltipTrigger><span className="transcode-federation-code-progress" aria-hidden="true"><span style={{ "--pairing-code-progress-start": 0.35, "--pairing-code-progress-duration": "19500ms" } as React.CSSProperties} /></span></div><TooltipTrigger ariaLabel="Reset code" content="Reset code" className="secondary icon-only-button transcode-federation-code-action" pinOnClick={false}><History aria-hidden="true" className="nav-icon" size={16} /></TooltipTrigger></div>
                    </div>
                  </div>
                  <div id="catalog-federation-body" className="transcode-federation-content"><div className="transcode-federation-addresses"><div className="transcode-federation-subheading"><strong>Reachable network addresses</strong></div><div className="transcode-federation-address-list"><div className="transcode-federation-address-item"><code>http://medialyze-nas.local:8091</code><TooltipTrigger ariaLabel="Copy address" content="Copy address" className="secondary icon-only-button transcode-federation-address-copy" pinOnClick={false}><CopyIcon aria-hidden="true" className="nav-icon" size={15} /></TooltipTrigger></div><div className="transcode-federation-address-item"><code>http://192.168.1.20:8091</code><TooltipTrigger ariaLabel="Copy address" content="Copy address" className="secondary icon-only-button transcode-federation-address-copy" pinOnClick={false}><CopyIcon aria-hidden="true" className="nav-icon" size={15} /></TooltipTrigger></div></div></div></div>
                </section>
              </VariantCard>
              <VariantCard title="Federation listener unavailable" source={`${settings} > Transcoding > Federation`} classes={["transcode-federation-panel", "transcode-federation-heading", "transcode-federation-heading-main", "transcode-federation-section-chevron", "transcode-federation-toggle", "transcode-federation-listener-error", "alert"]} wide>
                <section className="transcode-federation-panel">
                  <div className="transcode-federation-heading"><div className="transcode-federation-heading-main"><button type="button" className="transcode-federation-section-chevron" aria-label="Collapse Federation" title="Collapse Federation" aria-expanded="true"><ChevronDown aria-hidden="true" className="nav-icon" /></button><label className="toggle-switch transcode-federation-toggle"><input type="checkbox" role="switch" defaultChecked aria-label="Enable direct federation for this installation" /><span className="toggle-switch-track" aria-hidden="true"><span className="toggle-switch-thumb" /></span></label><h3>Federation</h3></div></div>
                  <div className="alert transcode-federation-listener-error" role="alert"><strong>Federation listener unavailable</strong><span>Federation listener is unavailable on port 8091: the port is already in use by another process. Remote sync and network tests remain unavailable until this listener is running.</span></div>
                </section>
              </VariantCard>
              <VariantCard title="New installation: untested capability matrix" source={`${settings} > Transcoding > Accelerators (before Test Hardware)`} classes={["panel-header", "panel-title-row", "async-panel-header-status", "settings-panel-header-action", "transcode-automation-tab-content", "transcode-automation-toggle-row", "transcode-automation-tab-controls", "transcode-automation-tab-list", "transcode-automation-tab-button", "transcode-automation-tab-label", "transcode-capability-section", "transcode-capability-content", "transcode-capability-list", "compatibility-profile-list", "panel-empty-state", "panel-empty-state-icon"]}>
                <div className="panel-header">
                  <div className="panel-title-row"><h2>Transcoding</h2></div>
                  <div className="async-panel-header-status"><button type="button" className="secondary small settings-panel-header-action"><FlaskConical aria-hidden="true" size={16} />Test Hardware</button></div>
                </div>
                <section className="transcode-automation-tab-content transcode-capability-section transcode-capability-content">
                  <div className="compatibility-profile-list transcode-capability-list">
                    <div className="settings-profile-toggle-row transcode-automation-toggle-row">
                      <div className="transcode-automation-tab-controls">
                        <div className="transcode-automation-tab-list" role="tablist" aria-label="Transcoding profiles and rules" aria-orientation="horizontal">
                          <button type="button" id="catalog-untested-transcode-tab-profiles" role="tab" className="transcode-automation-tab-button" aria-selected="false" tabIndex={-1}><span className="transcode-automation-tab-label">Profiles</span></button>
                          <button type="button" id="catalog-untested-transcode-tab-rules" role="tab" className="transcode-automation-tab-button" aria-selected="false" tabIndex={-1}><span className="transcode-automation-tab-label">Rules</span></button>
                          <button type="button" id="catalog-untested-transcode-tab-accelerators" role="tab" className="transcode-automation-tab-button active" aria-selected="true" tabIndex={0}><span className="transcode-automation-tab-label">Accelerators</span></button>
                          <button type="button" id="catalog-untested-transcode-tab-members" role="tab" className="transcode-automation-tab-button" aria-selected="false" tabIndex={-1}><span className="transcode-automation-tab-label">Members</span></button>
                        </div>
                        <TooltipTrigger ariaLabel="Explain accelerators" tooltipClassName="transcode-automation-description-tooltip-portal" maxWidth={460} content={<div className="transcode-matrix-meta"><strong>FFmpeg: ffmpeg version test</strong><p>Hardware counts use representative codec pairs and repeated measurements.</p></div>}>?</TooltipTrigger>
                      </div>
                    </div>
                    <PanelEmptyState message="No capability matrix data yet. Run the hardware test to populate this matrix." />
                  </div>
                </section>
              </VariantCard>
              <VariantCard title="Tested transcoding settings and compact accelerator matrix · local and federation origins" source={`${settings} > Transcoding (after Test Hardware)`} classes={["panel-header", "panel-title-row", "async-panel-header-status", "settings-panel-header-action", "settings-sidebar-stack", "app-settings-performance-grid", "field", "field-label-row", "transcode-automation-tab-content", "transcode-capability-section", "transcode-capability-content", "transcode-capability-list", "compatibility-profile-list", "compatibility-profile-list-item", "compatibility-profile-list-trigger", "transcode-automation-list-copy", "transcode-capability-device-copy", "transcode-capability-device-name", "transcode-capability-device-icon", "transcode-capability-device-icon-gpu", "transcode-capability-device-icon-cpu", "transcode-federation-member-pill", "transcode-federation-local-pill", "transcode-device-matrix", "transcode-matrix-table", "transcode-matrix-cell-trigger", "transcode-matrix-tooltip-preview", "transcode-matrix-tooltip-content", "transcode-matrix-tooltip-heading", "transcode-matrix-tooltip-status", "transcode-matrix-tooltip-row", "transcode-matrix-tooltip-path", "transcode-matrix-tooltip-path-arrow", "transcode-matrix-tooltip-benchmark", "transcode-matrix-tooltip-workload", "transcode-matrix-tooltip-summary", "transcode-matrix-tooltip-level", "transcode-matrix-tooltip-runs", "transcode-matrix-tooltip-level-result", "transcode-matrix-axis-label", "transcode-matrix-axis-label-horizontal", "transcode-matrix-axis-label-vertical", "transcode-replacement-warning"]} wide>
                <div className="panel-header">
                  <div className="panel-title-row">
                    <h2>Transcoding</h2>
                    <TooltipTrigger ariaLabel="Explain transcoding runtime settings" content="Choose the required execution path, output safety policy, resource limits, and inspect the real FFmpeg hardware probes.">
                      ?
                    </TooltipTrigger>
                  </div>
                  <div className="async-panel-header-status">
                    <button type="button" className="secondary small settings-panel-header-action">
                      <FlaskConical aria-hidden="true" size={16} />
                      Test Hardware
                    </button>
                    <button type="button" className="secondary small settings-panel-header-action">
                      <Network aria-hidden="true" size={16} />
                      Test network
                    </button>
                  </div>
                </div>
                <div className="settings-sidebar-stack">
                  <div className="app-settings-performance-grid">
                    <div className="field"><div className="field-label-row"><label htmlFor="catalog-transcoding-execution">Execution mode</label><TooltipTrigger ariaLabel="Explain hardware-required execution" content="Hardware-required jobs fail clearly when the selected encoder or device is unavailable; they never fall back silently to CPU.">?</TooltipTrigger></div><select id="catalog-transcoding-execution" className="settings-choice-input" defaultValue="hardware_required"><option value="hardware_required">Hardware required</option><option value="cpu_only">CPU only</option></select></div>
                    <div className="field"><div className="field-label-row"><label htmlFor="catalog-transcoding-output">Default output mode</label><TooltipTrigger ariaLabel="Explain default output mode" content="Separate output works with a read-only media mount; same-directory and replacement require a writable media directory.">?</TooltipTrigger></div><select id="catalog-transcoding-output" className="settings-choice-input" defaultValue="transcode_output"><option value="transcode_output">Separate Transcode_Output</option><option value="same_directory">Next to source file</option><option value="replace_original">Replace original</option></select></div>
                    <div className="field"><div className="field-label-row"><label htmlFor="catalog-transcoding-cpu">CPU budget (%)</label><TooltipTrigger ariaLabel="Explain CPU budget" content="Soft budget shared across active CPU transcode jobs; short bursts can exceed it.">?</TooltipTrigger></div><input id="catalog-transcoding-cpu" className="settings-choice-input" type="number" defaultValue="90" /></div>
                    <div className="field"><label htmlFor="catalog-transcoding-remove-partial">Partial output</label><select id="catalog-transcoding-remove-partial" className="settings-choice-input" defaultValue="yes"><option value="yes">Remove</option><option value="no">Keep</option></select></div>
                  </div>
                  <section className="transcode-automation-tab-content transcode-capability-section transcode-capability-content">
                    <div className="compatibility-profile-list transcode-capability-list">
                      <details className="compatibility-profile-list-item transcode-device-matrix">
                        <summary className="compatibility-profile-list-trigger"><span className="transcode-automation-list-copy transcode-capability-device-copy"><span className="transcode-capability-device-name"><Gpu aria-hidden="true" className="transcode-capability-device-icon transcode-capability-device-icon-gpu" size={16} /><strong>NVIDIA GeForce RTX 3080</strong><span className="badge transcode-federation-member-pill">Worker 02</span></span><small>cuda</small></span><ChevronDown aria-hidden="true" /></summary>
                        <div className="transcode-matrix-scroll" tabIndex={0}>
                          <table className="transcode-matrix-table"><thead><tr><th className="transcode-matrix-corner"><span className="transcode-matrix-axis-label transcode-matrix-axis-label-horizontal">Encode</span><span className="transcode-matrix-axis-label transcode-matrix-axis-label-vertical">Decode</span></th><th>H.264 / AVC</th><th>H.265 / HEVC</th><th>AV1</th></tr></thead><tbody><tr><th>H.264 / AVC</th><td className="transcode-matrix-hardware">HW · 4×</td><td className="transcode-matrix-hardware">HW · 4×</td><td className="transcode-matrix-hardware">HW · 3×</td></tr><tr><th>H.265 / HEVC</th><td className="transcode-matrix-hardware">HW · 4×</td><td className="transcode-matrix-hardware">HW · 4×</td><td className="transcode-matrix-hardware">HW · 3×</td></tr><tr><th>AV1</th><td className="transcode-matrix-software">Software</td><td className="transcode-matrix-software">Software</td><td className="transcode-matrix-unsupported">—</td></tr></tbody></table>
                         </div>
                         <div className="transcode-matrix-tooltip-preview">
                           <span className="field-hint">Hover or focus a matrix cell:</span>
                           <TooltipTrigger
                             ariaLabel="Show repeated-run benchmark details"
                             className="transcode-matrix-cell-trigger"
                             tooltipClassName="transcode-matrix-tooltip-portal"
                             maxWidth={420}
                             placement="auto"
                             content={(
                               <div className="transcode-matrix-tooltip-content">
                                 <div className="transcode-matrix-tooltip-heading"><strong>H.264 / AVC → H.265 / HEVC</strong><span className="transcode-matrix-tooltip-status is-hardware">Hardware path</span></div>
                                 <div className="transcode-matrix-tooltip-row transcode-matrix-tooltip-path"><span>Decoder: cuda:h264</span><span className="transcode-matrix-tooltip-path-arrow" aria-hidden="true">→</span><span>Encoder: hevc_nvenc</span></div>
                                 <div className="transcode-matrix-tooltip-benchmark"><div className="transcode-matrix-tooltip-workload">Workload: 256×256 · 30 fps · 240 frames</div><div className="transcode-matrix-tooltip-level"><div className="transcode-matrix-tooltip-level-head"><strong>4 sessions</strong><span>within limit</span></div><div className="transcode-matrix-tooltip-runs"><span>Run 1: 0.502 s</span><span>Run 2: 0.498 s</span><span>Run 3: 0.515 s</span></div><div className="transcode-matrix-tooltip-level-result"><span>Median: 0.502 s</span><span>+8.4 %</span></div></div></div>
                               </div>
                             )}
                           >
                             HW · 4×
                           </TooltipTrigger>
                         </div>
                      </details>
                      <details className="compatibility-profile-list-item transcode-device-matrix" open>
                        <summary className="compatibility-profile-list-trigger"><span className="transcode-automation-list-copy transcode-capability-device-copy"><span className="transcode-capability-device-name"><Cpu aria-hidden="true" className="transcode-capability-device-icon transcode-capability-device-icon-cpu" size={16} /><strong>Intel CPU iGPU · Quick Sync</strong><span className="badge transcode-federation-member-pill transcode-federation-local-pill">local</span></span><small>qsv + vaapi</small></span><ChevronDown aria-hidden="true" /></summary>
                        <div className="transcode-matrix-scroll" tabIndex={0}>
                          <table className="transcode-matrix-table"><thead><tr><th className="transcode-matrix-corner"><span className="transcode-matrix-axis-label transcode-matrix-axis-label-horizontal">Encode</span><span className="transcode-matrix-axis-label transcode-matrix-axis-label-vertical">Decode</span></th><th>H.264 / AVC</th><th>H.265 / HEVC</th><th>AV1</th></tr></thead><tbody><tr><th>H.264 / AVC</th><td className="transcode-matrix-hardware">HW · 4×</td><td className="transcode-matrix-hardware">HW · 4×</td><td className="transcode-matrix-software">Software</td></tr><tr><th>H.265 / HEVC</th><td className="transcode-matrix-hardware">HW · 4×</td><td className="transcode-matrix-hardware">HW · 4×</td><td className="transcode-matrix-software">Software</td></tr><tr><th>AV1</th><td className="transcode-matrix-hardware">HW · 4×</td><td className="transcode-matrix-hardware">HW · 4×</td><td className="transcode-matrix-software">Software</td></tr></tbody></table>
                         </div>
                       </details>
                    </div>
                  </section>
                   <div className="transcode-replacement-warning"><div className="notice warning">Replacing the original writes in place without a byte-for-byte backup.</div><p className="field-hint">This feature is still being tested; errors are possible and it is not recommended for normal use.</p><label className="transcode-filename-option"><input type="checkbox" /><span>I understand and confirm replacing the original file</span></label></div>
                </div>
              </VariantCard>
              <VariantCard title="Compact transcoding automation tabs · expanded hit areas" source={`${settings} > Transcoding > TranscodeProfilesRulesPanel`} classes={["transcode-automation-section", "settings-profile-toggle-row", "transcode-automation-toggle-row", "transcode-automation-tab-controls", "transcode-automation-tab-list", "transcode-automation-tab-button", "transcode-automation-tab-label", "transcode-automation-tab-content", "transcode-automation-quick-actions", "settings-profile-toggle-actions", "transcode-automation-content", "transcode-capability-section", "transcode-capability-content", "transcode-capability-list", "compatibility-profile-list", "compatibility-profile-list-item", "compatibility-profile-list-row", "compatibility-profile-list-trigger", "compatibility-profile-quick-actions", "compatibility-profile-quick-action", "compatibility-profile-details", "compatibility-profile-card-actions", "compatibility-profile-form-grid", "compatibility-profile-field-wide", "compatibility-capability-sections", "compatibility-capability-section", "compatibility-capability-section-body", "transcode-automation-list-copy", "transcode-federation-member-list-copy", "transcode-federation-member-tab-details", "transcode-capability-device-copy", "transcode-capability-device-name", "transcode-federation-member-pill", "transcode-device-matrix", "transcode-matrix-table", "transcode-matrix-scroll", "transcode-automation-summary-form-grid", "transcode-automation-rule-sections", "transcode-automation-section-summary", "transcode-profile-section-count", "transcode-profile-rule", "transcode-profile-rule-summary", "transcode-profile-rule-summary-grid", "transcode-profile-rule-field", "transcode-profile-rule-section", "transcode-automation-description-tooltip", "transcode-automation-description-tooltip-portal", "transcode-automation-details", "transcode-automation-editor", "transcode-automation-editor-actions", "transcode-condition-group", "transcode-condition-list", "transcode-condition-row", "transcode-actions", "settings-panel-header-action", "transcode-action-button", "badge"]} wide>
                <section className="app-settings-section transcode-automation-section">
                  <div className="compatibility-profile-panel transcode-automation-content">
                    <section className="transcode-automation-tab-content">
                      <div className="compatibility-profile-list">
                      <div className="settings-profile-toggle-row transcode-automation-toggle-row">
                        <div className="transcode-automation-tab-controls">
                          <div className="transcode-automation-tab-list" role="tablist" aria-label="Transcoding profiles and rules" aria-orientation="horizontal">
                            <button type="button" id="catalog-automation-transcode-tab-profiles" role="tab" className="transcode-automation-tab-button active" aria-selected="true" tabIndex={0}><span className="transcode-automation-tab-label">Profiles</span></button>
                            <button type="button" id="catalog-automation-transcode-tab-rules" role="tab" className="transcode-automation-tab-button" aria-selected="false" tabIndex={-1}><span className="transcode-automation-tab-label">Rules</span></button>
                            <button type="button" id="catalog-automation-transcode-tab-accelerators" role="tab" className="transcode-automation-tab-button" aria-selected="false" tabIndex={-1}><span className="transcode-automation-tab-label">Accelerators</span></button>
                            <button type="button" id="catalog-automation-transcode-tab-members" role="tab" className="transcode-automation-tab-button" aria-selected="false" tabIndex={-1}><span className="transcode-automation-tab-label">Members</span></button>
                          </div>
                          <TooltipTrigger ariaLabel="Explain transcoding profiles" tooltipClassName="transcode-automation-description-tooltip-portal transcode-automation-description-tooltip-portal-compact" maxWidth={300} align="start" placement="center" content={<div className="transcode-automation-description-tooltip"><p>Reusable versioned stream plans; built-in profiles are immutable templates.</p><p>Automation uses the existing path, collision, capability, queue, and retry safeguards.</p></div>}>?</TooltipTrigger>
                        </div>
                        <div className="settings-profile-toggle-actions"><button type="button" className="secondary small settings-panel-header-action"><Plus size={14} aria-hidden="true" />New profile</button></div>
                      </div>
                      <article className="compatibility-profile-list-item is-expanded">
                        <div className="compatibility-profile-list-row">
                          <button type="button" className="compatibility-profile-list-trigger" aria-expanded="true"><span className="transcode-automation-list-copy"><strong>Save storage</strong></span><ChevronDown aria-hidden="true" /></button>
                          <div className="compatibility-profile-quick-actions">
                            <button type="button" className="secondary icon-only-button compatibility-profile-quick-action" aria-label="Customize Save storage" title="Create an editable copy"><SquarePenIcon size={18} aria-hidden="true" className="nav-icon" /></button>
                            <button type="button" className="secondary icon-only-button compatibility-profile-quick-action" aria-label="Delete Save storage" title="Built-in templates cannot be deleted" disabled><Trash2 size={18} aria-hidden="true" className="nav-icon" /></button>
                          </div>
                        </div>
                          <div className="compatibility-profile-details transcode-automation-details">
                           <div className="compatibility-profile-form-grid transcode-automation-summary-form-grid"><label><span>Container</span><select className="settings-choice-input" disabled value="mkv" onChange={() => undefined}><option value="mkv">MKV</option></select></label><label><span>Execution mode</span><select className="settings-choice-input" disabled value="inherit" onChange={() => undefined}><option value="inherit">Use global setting</option></select></label><label><span>Dynamic range</span><select className="settings-choice-input" disabled value="preserve" onChange={() => undefined}><option value="preserve">Preserve</option></select></label><label><span>Used by automatic rules</span><input className="settings-choice-input" readOnly value="2" /></label></div>
                           <div className="compatibility-capability-sections transcode-automation-rule-sections"><details className="compatibility-capability-section"><summary className="transcode-automation-section-summary"><span>Video stream rules</span><strong className="transcode-profile-section-count">1</strong></summary><div className="compatibility-capability-section-body"><div className="transcode-profile-rule transcode-profile-rule-summary"><strong>Encode</strong><div className="transcode-profile-rule-summary-grid"><div><span>Codec match</span><strong>h264</strong></div><div><span>Stream action</span><strong>Encode</strong></div></div></div></div></details><details className="compatibility-capability-section"><summary className="transcode-automation-section-summary"><span>Audio stream rules</span><strong className="transcode-profile-section-count">0</strong></summary><div className="compatibility-capability-section-body"><p className="field-hint">—</p></div></details></div>
                           <p className="field-hint">MKV / HEVC, copy compatible streams, encode unmatched video.</p>
                         </div>
                       </article>
                     </div>
                     </section>
                   </div>
                 </section>
              </VariantCard>
              <VariantCard title="Federation members tab" source={`${settings} > Transcoding > Members`} classes={["transcode-automation-section", "transcode-automation-content", "transcode-automation-tab-content", "settings-profile-toggle-row", "transcode-automation-toggle-row", "transcode-automation-tab-controls", "transcode-federation-discovered-refresh", "transcode-federation-member-row", "transcode-federation-member-trigger-shell", "transcode-federation-member-trigger", "transcode-federation-status-trigger", "transcode-federation-status-tooltip", "transcode-federation-status-tooltip-heading", "transcode-federation-status-tooltip-hint", "transcode-federation-status-tooltip-item", "transcode-federation-peer", "transcode-federation-peer-name", "transcode-federation-member-name", "transcode-federation-entry-marker", "transcode-federation-status-marker", "transcode-federation-add-icon", "transcode-federation-peer-connect-control", "transcode-federation-segment-input", "transcode-federation-peer-code-input", "transcode-federation-connect-button", "transcode-federation-action-icon", "transcode-federation-manual-item", "transcode-federation-manual-address-input", "transcode-federation-manual-code-input", "transcode-federation-manual-connect-control", "compatibility-profile-list", "compatibility-profile-list-item", "compatibility-profile-list-row", "compatibility-profile-list-trigger", "compatibility-profile-quick-actions", "transcode-automation-quick-actions", "compatibility-profile-quick-action", "compatibility-profile-details", "transcode-automation-list-copy", "transcode-federation-member-list-copy", "transcode-federation-member-tab-details", "transcode-federation-member-connections", "transcode-federation-member-detail-label", "transcode-federation-member-endpoint-list", "transcode-federation-member-endpoint", "transcode-federation-member-endpoint-main", "transcode-federation-member-endpoint-metrics", "transcode-federation-member-endpoint-actions", "transcode-federation-member-endpoint-action", "transcode-federation-endpoint-favorite", "transcode-federation-endpoint-status", "status-dot", "notice", "success"]} wide>
                <section className="app-settings-section transcode-automation-section">
                  <div className="compatibility-profile-panel transcode-automation-content">
                    <div className="notice success" role="status">Worker 02 disconnected. It is now available under Discovered installations for pairing again.</div>
                     <section className="transcode-automation-tab-content">
                      <div className="compatibility-profile-list">
                        <div className="settings-profile-toggle-row transcode-automation-toggle-row">
                          <div className="transcode-automation-tab-controls">
                            <div className="transcode-automation-tab-list" role="tablist" aria-label="Transcoding profiles and rules" aria-orientation="horizontal">
                              <button type="button" id="catalog-members-transcode-tab-profiles" role="tab" className="transcode-automation-tab-button" aria-selected="false" tabIndex={-1}><span className="transcode-automation-tab-label">Profiles</span></button>
                              <button type="button" id="catalog-members-transcode-tab-rules" role="tab" className="transcode-automation-tab-button" aria-selected="false" tabIndex={-1}><span className="transcode-automation-tab-label">Rules</span></button>
                              <button type="button" id="catalog-members-transcode-tab-accelerators" role="tab" className="transcode-automation-tab-button" aria-selected="false" tabIndex={-1}><span className="transcode-automation-tab-label">Accelerators</span></button>
                              <button type="button" id="catalog-members-transcode-tab-members" role="tab" className="transcode-automation-tab-button active" aria-selected="true" tabIndex={0}><span className="transcode-automation-tab-label">Members</span></button>
                            </div>
                            <TooltipTrigger ariaLabel="Explain federation members" tooltipClassName="transcode-automation-description-tooltip-portal transcode-automation-description-tooltip-portal-compact" maxWidth={300} align="start" placement="center" content={<div className="transcode-automation-description-tooltip"><p>Review trusted federation installations and their reachability.</p><p>Pairing is direct; members are not used as relays.</p></div>}>?</TooltipTrigger>
                            <TooltipTrigger ariaLabel="Refresh discovery" content="Refresh discovery" className="secondary icon-only-button compatibility-profile-quick-action transcode-federation-discovered-refresh" pinOnClick={false}><RefreshCw aria-hidden="true" size={16} /></TooltipTrigger>
                        </div>
                        </div>
                        <article className="compatibility-profile-list-item is-expanded">
                          <div className="compatibility-profile-list-row transcode-federation-member-row">
                            <div className="transcode-federation-member-trigger-shell">
                              <TooltipTrigger ariaLabel="Worker 02: Connection warning" className="transcode-federation-status-trigger" align="start" placement="auto" maxWidth={360} pinOnClick={false} content={<div className="transcode-federation-status-tooltip"><strong className="transcode-federation-status-tooltip-heading is-warning">Connection warning</strong><div className="transcode-federation-status-tooltip-item is-error"><span>Last error</span><p>timed out</p></div></div>}>
                                <span className="transcode-federation-entry-marker transcode-federation-status-marker"><span className="status-dot is-warning" aria-hidden="true" /></span>
                              </TooltipTrigger>
                              <button type="button" className="compatibility-profile-list-trigger transcode-federation-member-trigger" aria-expanded="true"><span className="transcode-automation-list-copy transcode-federation-member-list-copy"><strong><span className="transcode-federation-member-name">Worker 02</span></strong><small>16 CPU · 420 GB free · 0 active jobs · v0.18.0</small></span><ChevronDown aria-hidden="true" /></button>
                            </div>
                            <div className="compatibility-profile-quick-actions transcode-automation-quick-actions"><button type="button" className="secondary icon-only-button compatibility-profile-quick-action" aria-label="Sync Worker 02" title="Sync"><RefreshCw size={18} aria-hidden="true" /></button><button type="button" className="secondary icon-only-button compatibility-profile-quick-action danger" aria-label="Disconnect Worker 02" title="Disconnect"><Unplug size={18} aria-hidden="true" /></button></div>
                          </div>
                          <div className="compatibility-profile-details transcode-automation-details transcode-federation-member-tab-details">
                            <div className="transcode-federation-member-connections">
                              <span className="transcode-federation-member-detail-label">Available connections</span>
                              <p className="field-hint">The favorite is used by default. It is skipped only while unreachable and another connection is reachable.</p>
                              <ul className="transcode-federation-member-endpoint-list">
                                <li className="transcode-federation-member-endpoint is-reachable is-favorite">
                                  <div className="transcode-federation-member-endpoint-main"><span className="status-dot is-online" aria-hidden="true" /><code title="http://worker-02:8091">http://worker-02:8091</code><span className="badge transcode-federation-endpoint-favorite">Favorite</span></div>
                                  <div className="transcode-federation-member-endpoint-metrics"><span title="Ping"><Clock3 aria-hidden="true" size={13} />Ping <strong>4.2 ms</strong></span><span title="Throughput"><Gauge aria-hidden="true" size={13} />Throughput <strong>812.5 Mbit/s</strong></span><span className="transcode-federation-endpoint-status is-reachable">Reachable</span><small>Tested 10.09.2026, 10:00</small></div>
                                  <div className="transcode-federation-member-endpoint-actions"><button type="button" className="secondary icon-only-button compatibility-profile-quick-action transcode-federation-member-endpoint-action is-favorite" aria-label="Remove favorite connection: http://worker-02:8091" aria-pressed="true" title="Remove favorite connection"><Star aria-hidden="true" size={16} fill="currentColor" /></button><button type="button" className="secondary icon-only-button compatibility-profile-quick-action transcode-federation-member-endpoint-action" aria-label="Block this connection: http://worker-02:8091" aria-pressed="false" title="Block this connection"><Ban aria-hidden="true" size={16} /></button></div>
                                </li>
                                <li className="transcode-federation-member-endpoint is-unreachable is-blocked">
                                  <div className="transcode-federation-member-endpoint-main"><span className="status-dot is-offline" aria-hidden="true" /><code title="http://worker-02-backup:8091">http://worker-02-backup:8091</code></div>
                                  <div className="transcode-federation-member-endpoint-metrics"><span title="Ping"><Clock3 aria-hidden="true" size={13} />Ping <strong>—</strong></span><span title="Throughput"><Gauge aria-hidden="true" size={13} />Throughput <strong>—</strong></span><span className="transcode-federation-endpoint-status is-blocked">Blocked</span><small>Tested 10.09.2026, 09:58</small></div>
                                  <div className="transcode-federation-member-endpoint-actions"><button type="button" className="secondary icon-only-button compatibility-profile-quick-action transcode-federation-member-endpoint-action" aria-label="Use this connection as favorite: http://worker-02-backup:8091" aria-pressed="false" title="Use this connection as favorite" disabled><Star aria-hidden="true" size={16} /></button><button type="button" className="secondary icon-only-button compatibility-profile-quick-action transcode-federation-member-endpoint-action is-blocked" aria-label="Unblock this connection: http://worker-02-backup:8091" aria-pressed="true" title="Unblock this connection"><Ban aria-hidden="true" size={16} /></button></div>
                                </li>
                              </ul>
                            </div>
                          </div>
                        </article>
                        <article className="compatibility-profile-list-item transcode-federation-peer"><span><strong><Plus aria-hidden="true" className="transcode-federation-add-icon" size={16} /><span className="transcode-federation-peer-name">Worker 01</span></strong><small>http://worker-01:8091 · v0.18.0</small></span><div className="transcode-federation-peer-connect-control"><input className="settings-choice-input transcode-federation-segment-input transcode-federation-peer-code-input is-invalid" type="text" inputMode="numeric" autoComplete="one-time-code" maxLength={6} pattern="[0-9]{6}" placeholder="Pairing code" aria-label="Pairing code" value="" readOnly onChange={() => undefined} /><button type="button" className="secondary small settings-panel-header-action transcode-federation-connect-button"><AnimatedConnectIcon className="transcode-federation-action-icon" size={16} aria-hidden="true" />Connect</button></div></article>
                        <article className="compatibility-profile-list-item transcode-federation-manual-item"><Plus aria-hidden="true" className="transcode-federation-entry-marker transcode-federation-add-icon" size={16} /><div className="transcode-federation-peer-connect-control transcode-federation-manual-connect-control"><input className="settings-choice-input transcode-federation-segment-input transcode-federation-manual-address-input" type="url" placeholder="http://host:8091" aria-label="http://host:8091" value="" readOnly onChange={() => undefined} /><input className="settings-choice-input transcode-federation-segment-input transcode-federation-peer-code-input transcode-federation-manual-code-input" type="text" inputMode="numeric" autoComplete="one-time-code" maxLength={6} pattern="[0-9]{6}" placeholder="Pairing code" aria-label="Pairing code" value="" readOnly onChange={() => undefined} /><button type="button" className="secondary small settings-panel-header-action transcode-federation-connect-button"><AnimatedConnectIcon className="transcode-federation-action-icon" size={16} aria-hidden="true" />Connect</button></div></article>
                       </div>
                       </section>
                     </div>
                   </section>
               </VariantCard>
              <VariantCard title="Preview with synchronized comparison" source="FileDetailPage > Preview > automatic linked-variant comparison" classes={["file-detail-preview-stack", "file-detail-preview-comparison-panel", "video-wipe-compare", "video-wipe-stage", "video-wipe-divider", "video-wipe-handle", "video-wipe-label", "video-wipe-controls"]} wide>
                <div className="file-detail-preview-stack">
                  <div className="file-detail-preview-panel">
                    <div className="file-detail-preview-player-shell">
                      <video className="file-detail-preview-player" controls aria-label="Original preview" />
                    </div>
                  </div>
                  <div className="file-detail-preview-panel file-detail-preview-comparison-panel">
                    <h3>Synchronized preview comparison</h3>
                    <VideoWipeCompare first={{ src: "data:video/mp4;base64,", label: "Original" }} second={{ src: "data:video/mp4;base64,", label: "Variant" }} />
                  </div>
                </div>
              </VariantCard>
              <VariantCard title="Combined file and transcode history" source={`${fileDetail} > File history`} classes={["file-history-with-transcoding", "transcode-history-section", "transcode-history-list", "file-history-entry", "file-history-entry-head"]} wide>
                <div className="file-history-with-transcoding">
                  <div className="file-history-list">
                    <div className="notice">Latest file snapshots and transcode results stay together on File history.</div>
                  </div>
                  <section className="transcode-history-section">
                    <h3>File &amp; Transcode history</h3>
                    <div className="transcode-history-list">
                      <details className="file-history-entry" open>
                        <summary className="file-history-entry-head">
                          <span className="file-history-entry-chevron" aria-hidden="true"><ChevronRight className="nav-icon" /></span>
                          <strong>Compatibility</strong>
                          <span className="badge transcode-status-completed">Completed</span>
                          <span>Movies/Arrival [1080p, H.264].mp4</span>
                        </summary>
                      </details>
                    </div>
                  </section>
                </div>
              </VariantCard>
              <VariantCard title="Path browser fixture" source={`${settings} > Create library`} classes={["path-browser", "path-entry", "path-browser-selected-item"]}>
                <PathBrowserFixture />
              </VariantCard>
              <VariantCard title="Path browser missing folder recovery" source={`${settings} > Libraries > Change path`} classes={["path-browser", "alert", "path-browser-selected-item"]}>
                <MissingPathBrowserFixture />
              </VariantCard>
              <VariantCard title="Telemetry controls" source={`${settings} > Telemetry / Release notes`} classes={["telemetry-mode-toggle", "telemetry-mode-card", "telemetry-preview-actions"]}>
                <div className="stack">
                  <TelemetryModeToggle mode="enabled" highlightEnabledOption onChange={() => undefined} />
                  <div className="telemetry-mode-card-grid">
                    <div className="telemetry-mode-card telemetry-mode-card-off"><strong>Off</strong><span>No payloads.</span></div>
                    <div className="telemetry-mode-card telemetry-mode-card-minimal"><strong>Minimal</strong><span>Runtime/system only.</span></div>
                    <div className="telemetry-mode-card telemetry-mode-card-enabled"><strong>Enabled</strong><span>Rounded usage counts.</span></div>
                  </div>
                </div>
              </VariantCard>
            </VariantGroup>
          </CatalogSection>

          <CatalogSection definition={catalogSections[11]}>
            <VariantGroup title="Dialogs, popovers, tooltips">
              <VariantCard title="Release notes dialog" source={releaseNotes} classes={["release-notes-dialog", "release-notes-header", "release-notes-version"]} wide>
                <div className="ui-elements-dialog-demo">
                  <ReleaseDialogFixture />
                </div>
              </VariantCard>
              <VariantCard title="Create library dialog shell" source={`${settings} > Add library`} classes={["settings-create-library-backdrop", "settings-create-library-dialog", "settings-create-library-dialog-header"]}>
                <div className="settings-create-library-backdrop ui-elements-static-backdrop">
                  <section className="settings-create-library-dialog">
                    <div className="settings-create-library-dialog-header">
                      <h2>Create library</h2>
                      <button type="button" className="secondary icon-only-button settings-create-library-dialog-close" aria-label="Close">
                        <X className="nav-icon" />
                      </button>
                    </div>
                    <div className="form-grid">
                      <div className="field"><label>Name</label><input className="settings-choice-input" defaultValue="Movies" /></div>
                    </div>
                  </section>
                </div>
              </VariantCard>
              <VariantCard title="Change library path dialog shell" source={`${settings} > Libraries > Edit library`} classes={["settings-create-library-backdrop", "settings-create-library-dialog", "path-browser-selected-item"]}>
                <div className="settings-create-library-backdrop ui-elements-static-backdrop">
                  <section className="settings-create-library-dialog">
                    <div className="settings-create-library-dialog-header">
                      <h2>Change path for Movies</h2>
                      <button type="button" className="secondary icon-only-button settings-create-library-dialog-close" aria-label="Close">
                        <X className="nav-icon" />
                      </button>
                    </div>
                    <div className="form-grid">
                      <p className="field-hint field-span-full">Update the folders for this library. Existing analysis history is kept.</p>
                      <div className="path-browser-selected-list field-span-full">
                        <div className="path-browser-selected-item">
                          <span className="path-browser-selected-path">/media/movies</span>
                          <button type="button" className="secondary icon-only-button path-browser-selected-remove" aria-label="Remove" title="Remove"><X aria-hidden="true" /></button>
                        </div>
                      </div>
                    </div>
                  </section>
                </div>
              </VariantCard>
              <VariantCard title="Set connector API key dialog" source={`${settings} > Connectors > Connection`} classes={["settings-create-library-backdrop", "settings-create-library-dialog", "connector-secret-dialog", "connector-secret-action-button"]} wide>
                <div className="settings-create-library-backdrop ui-elements-static-backdrop">
                  <section className="settings-create-library-dialog connector-secret-dialog" role="dialog" aria-modal="true" aria-labelledby="catalog-connector-secret-dialog-title">
                    <div className="settings-create-library-dialog-header">
                      <div><h2 id="catalog-connector-secret-dialog-title">Set API key</h2><p>An API key is already stored. Enter a new one to replace it.</p></div>
                      <button type="button" className="secondary icon-only-button" aria-label="Close"><X aria-hidden="true" /></button>
                    </div>
                    <div className="notice">An API key is already configured and can be replaced.</div>
                    <label><span>API key / secret</span><input className="settings-choice-input" type="password" autoFocus placeholder="Enter a new API key" /></label>
                    <div className="jellyfin-actions"><button type="button"><KeyRound aria-hidden="true" />Save key</button><button type="button" className="secondary">Cancel</button></div>
                  </section>
                </div>
              </VariantCard>
              <VariantCard title="Delete library confirmation dialog" source={`${settings} > Delete library`} classes={["settings-delete-library-dialog", "settings-delete-library-warning", "settings-delete-library-confirm-button"]} wide>
                <div className="settings-create-library-backdrop ui-elements-static-backdrop">
                  <section className="settings-create-library-dialog settings-delete-library-dialog">
                    <div className="settings-create-library-dialog-header">
                      <div className="settings-delete-library-title-block">
                        <h2>Delete Movies?</h2>
                        <p>This removes the library from MediaLyze and cannot be undone.</p>
                      </div>
                      <button type="button" className="secondary icon-only-button settings-create-library-dialog-close" aria-label="Close">
                        <X className="nav-icon" />
                      </button>
                    </div>
                    <div className="settings-delete-library-summary">
                      <div><span>Name</span><strong>Movies</strong></div>
                      <div><span>Path</span><strong>/media/movies</strong></div>
                    </div>
                    <div className="settings-delete-library-warning">
                      <p>The following MediaLyze database data will be deleted:</p>
                      <ul>
                        <li>Library configuration and scan settings</li>
                        <li>Analyzed metadata, scan jobs, duplicate data, and history</li>
                      </ul>
                    </div>
                    <p className="settings-delete-library-assets-note">Media files and assets in the library path are not deleted or modified.</p>
                    <div className="settings-delete-library-confirm-form">
                      <label>Type Movies to confirm.</label>
                      <input className="settings-choice-input" defaultValue="Movies" />
                      <div className="settings-delete-library-actions">
                        <button type="button" className="secondary">Cancel</button>
                        <button type="button" className="settings-delete-library-confirm-button">Delete library</button>
                      </div>
                    </div>
                  </section>
                </div>
              </VariantCard>
              <VariantCard title="Library deleting state" source={`${settings} > Configured libraries`} classes={["library-settings-card", "is-deleting", "library-delete-progress", "delete-badge"]}>
                <div className="media-card library-settings-card is-deleting" aria-busy="true">
                  <div className="library-settings-header">
                    <div className="library-title-row">
                      <div className="library-title-meta">
                        <div className="library-title-main">
                          <div className="library-title-heading"><button type="button" className="library-settings-chevron" aria-label="Show settings for Movies" aria-expanded="false" disabled><ChevronRight aria-hidden="true" className="nav-icon" /></button><h3><span className="file-link">Movies</span></h3></div>
                          <div className="meta-tags library-title-tags">
                            <span className="badge">Movies</span>
                            <span className="badge">Manual</span>
                            <span className="badge delete-badge">Deleting library…</span>
                          </div>
                        </div>
                      </div>
                      <div className="library-title-actions">
                        <button type="button" className="secondary icon-only-button" disabled><DashboardVisibilityIcon visible /></button>
                        <button type="button" className="secondary icon-only-button" disabled><SquarePenIcon className="nav-icon" /></button>
                        <button type="button" className="secondary icon-only-button" disabled><DeleteIcon size={20} className="nav-icon" /></button>
                      </div>
                    </div>
                  </div>
                  <div className="library-delete-progress" role="status">
                    <div className="progress is-indeterminate"><span /></div>
                    <span>Deleting library…</span>
                  </div>
                </div>
              </VariantCard>
              <VariantCard title="Search and quality popovers" source={`${libraryDetail} / ${settings}`} classes={["search-filter-picker-popover", "quality-picker-popover", "search-filter-picker-item"]}>
                <div className="ui-elements-popover-row">
                  <div className="search-filter-picker-popover ui-elements-static-popover">
                    <button type="button" className="search-filter-picker-item is-selected">Container</button>
                    <button type="button" className="search-filter-picker-item">Video codec</button>
                  </div>
                  <QualityPickerFixture open />
                </div>
              </VariantCard>
              <VariantCard title="Transcoding settings stack order" source="TranscodingSettingsPanel" classes={["settings-sidebar-stack", "transcode-automation-section", "transcode-automation-content", "transcode-federation-panel", "transcode-federation-heading"]} wide>
                <div className="settings-sidebar-stack">
                  <section className="app-settings-section transcode-automation-section">
                    <div className="compatibility-profile-panel transcode-automation-content">
                      <div className="settings-profile-toggle-row"><div className="transcode-automation-tab-controls"><div className="transcode-automation-tab-list" role="tablist" aria-label="Transcoding profiles and rules" aria-orientation="horizontal"><button type="button" id="catalog-transcode-stack-profiles" role="tab" className="transcode-automation-tab-button active" aria-selected="true" tabIndex={0}><span className="transcode-automation-tab-label">Profiles</span></button><button type="button" id="catalog-transcode-stack-rules" role="tab" className="transcode-automation-tab-button" aria-selected="false" tabIndex={-1}><span className="transcode-automation-tab-label">Rules</span></button><button type="button" id="catalog-transcode-stack-accelerators" role="tab" className="transcode-automation-tab-button" aria-selected="false" tabIndex={-1}><span className="transcode-automation-tab-label">Accelerators</span></button><button type="button" id="catalog-transcode-stack-members" role="tab" className="transcode-automation-tab-button" aria-selected="false" tabIndex={-1}><span className="transcode-automation-tab-label">Members</span></button></div></div></div>
                    </div>
                  </section>
                  <section className="transcode-federation-panel">
                    <div className="transcode-federation-heading"><div className="transcode-federation-heading-main"><button type="button" className="transcode-federation-section-chevron" aria-label="Collapse Federation" title="Collapse Federation" aria-expanded="true"><ChevronDown aria-hidden="true" className="nav-icon" /></button><label className="toggle-switch transcode-federation-toggle"><input type="checkbox" role="switch" defaultChecked aria-label="Enable direct federation for this installation" /><span className="toggle-switch-track" aria-hidden="true"><span className="toggle-switch-thumb" /></span></label><h3>Federation</h3></div></div>
                  </section>
                </div>
              </VariantCard>
              <VariantCard title="Tooltip trigger variants" source={`${fileDetail} / ${libraryDetail} / ${scanLogs}`} classes={["tooltip-trigger", "file-detail-badge-tooltip-trigger", "duplicate-group-badge-tooltip-trigger"]}>
                <div className="ui-elements-control-grid">
                  <TooltipTrigger ariaLabel="Open generic tooltip" content="Generic tooltip content.">
                    <Info className="nav-icon" />
                  </TooltipTrigger>
                  <button type="button" className="file-detail-badge-tooltip-trigger tooltip-trigger"><span className="badge">HEVC</span></button>
                  <button type="button" className="duplicate-group-badge-tooltip-trigger tooltip-trigger"><span className="badge">Hash</span></button>
                </div>
              </VariantCard>
            </VariantGroup>
          </CatalogSection>
        </div>
      </div>
    </main>
  );
}
