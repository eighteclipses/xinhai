declare const __PERSONAL_EDITION__: boolean
declare const __COMMERCIAL_EDITION__: boolean
export const PERSONAL_EDITION = typeof __PERSONAL_EDITION__ === 'undefined' ? true : __PERSONAL_EDITION__
export const COMMERCIAL_EDITION = typeof __COMMERCIAL_EDITION__ !== 'undefined' && __COMMERCIAL_EDITION__
// Third-party online music is not part of the commercial distribution scope.
export const ONLINE_MUSIC_ENABLED = !COMMERCIAL_EDITION
export const MODEL_ANALYSIS_ENABLED = !COMMERCIAL_EDITION
export const EDITION_NAME = PERSONAL_EDITION ? '自用' : ''
