export interface FocusReminderCapability {
  platform: 'desktop' | 'android'
  notificationsGranted: boolean
  exactAlarmsGranted: boolean
  canRequestExactAlarms: boolean
}
export type FocusReminderAccess = 'notifications' | 'exact-alarm' | 'background'
