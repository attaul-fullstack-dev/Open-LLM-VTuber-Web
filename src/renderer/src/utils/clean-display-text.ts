/** Keep authored paragraph breaks while removing technical presentation marks. */
export const cleanChatDisplayText = (value: string): string => value
  .replace(/\[[a-z][a-z0-9_-]*\]\s*/gi, '')
  .replace(/\*([^*]+)\*/g, '$1')
  .replace(/([.!?])(?=[A-Z])/g, '$1 ')
  .replace(/[ \t]+/g, ' ')
  .replace(/ *\n */g, '\n')
  .replace(/\n{3,}/g, '\n\n')
  .trim();
