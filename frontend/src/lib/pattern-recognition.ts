import type { AppSettings } from "./api";

export type PatternRecognitionSettings = NonNullable<AppSettings["pattern_recognition"]>;

export const DEFAULT_SHOW_SEASON_PATTERN_INPUTS = {
  series_folder_regexes: [String.raw`^(?P<title>.+?)(?:\s+\((?P<year>\d{4})\))?(?:\s+\[[^\]]+\])?$`],
  season_folder_regexes: [String.raw`^(?:Season|Staffel)\s*(?P<season>\d{1,3})$`],
};

const DEFAULT_BONUS_FOLDER_NAMES = [
  "behind the scenes",
  "deleted scenes",
  "interviews",
  "scenes",
  "samples",
  "shorts",
  "featurettes",
  "clips",
  "other",
  "extras",
  "trailers",
  "theme-music",
  "backdrops",
  "Specials",
  "Season 00",
];

const DEFAULT_BONUS_FILE_SUFFIXES = [
  "-trailer",
  ".trailer",
  "_trailer",
  " trailer",
  "-sample",
  ".sample",
  "_sample",
  " sample",
  "-scene",
  "-clip",
  "-interview",
  "-behindthescenes",
  "-deleted",
  "-deletedscene",
  "-featurette",
  "-short",
  "-other",
  "-extra",
];

export function defaultBonusFolderPatternInputs(): string[] {
  return DEFAULT_BONUS_FOLDER_NAMES.flatMap((name) => [`${name}/`, `${name}/*`, `*/${name}/`, `*/${name}/*`]);
}

export function defaultBonusFilePatternInputs(): string[] {
  return DEFAULT_BONUS_FILE_SUFFIXES.map((suffix) => `*${suffix}.*`);
}

export function defaultPatternRecognitionSettings(): PatternRecognitionSettings {
  const defaultFolderPatterns = defaultBonusFolderPatternInputs();
  const defaultFilePatterns = defaultBonusFilePatternInputs();
  return {
    analyze_bonus_content: true,
    show_season_patterns: DEFAULT_SHOW_SEASON_PATTERN_INPUTS,
    bonus_content: {
      user_folder_patterns: [],
      default_folder_patterns: defaultFolderPatterns,
      effective_folder_patterns: defaultFolderPatterns,
      user_file_patterns: [],
      default_file_patterns: defaultFilePatterns,
      effective_file_patterns: defaultFilePatterns,
    },
  };
}
