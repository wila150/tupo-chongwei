// 網站可改的資料集中在這裡：課表、聯絡方式、私人課可預約時間
window.SITE = {
  contact: {
    line: 'https://line.me/R/ti/p/@043ixcyx', // LINE 官方帳號「突破Boxing」
    lineOA: '@043ixcyx',  // 官方帳號 ID：預約完成用 oaMessage 預填訊息
    instagram: '',   // 例：https://instagram.com/xxxx （待補）
    phone: ''        // 例：0912345678 （待補）
  },

  // 固定課表（取自海報）。day: 0=週日 1=週一 ... 6=週六
  classes: [
    { day: 1, start: '10:30', end: '11:30', venue: '拳拳格鬥', name: '拳擊課', place: '台中' },
    { day: 1, start: '19:30', end: '21:00', venue: '東海大學', name: '社團課', place: '東海大學' },
    { day: 3, start: '19:50', end: '20:50', venue: '中興大學', name: '社團課', place: '中興大學' },
    { day: 4, start: '11:00', end: '12:00', venue: 'VAVA漾', name: '拳擊課', place: 'VAVA漾' },
    { day: 4, start: '18:10', end: '19:10', venue: 'VAVA漾', name: '兒童體能協調課', place: 'VAVA漾' },
    { day: 4, start: '20:30', end: '21:30', venue: 'VAVA漾', name: '拳擊課', place: 'VAVA漾' },
    { day: 6, start: '11:20', end: '12:20', venue: 'VAVA漾', name: '拳擊課', place: 'VAVA漾' },
    { day: 6, start: '15:40', end: '16:40', venue: 'VAVA漾', name: '兒童拳擊課', place: 'VAVA漾' },
    { day: 0, start: '11:00', end: '12:00', venue: '拳拳格鬥', name: '拳擊課', place: '台中' }
  ],

  // 私人課設定
  booking: {
    daysAhead: 21,        // 開放預約未來幾天
    minHoursAhead: 12,    // 最晚幾小時前可預約
    lessonMinutes: 60,
    bufferMinutes: 30,    // 團課前後留給移動的時間
    // 每天可預約的開始時間（之後可依教練實際狀況改）
    startTimes: ['08:00','09:00','10:00','11:00','12:00','13:00','14:00','15:00','16:00','17:00','18:00','19:00','20:00','21:00']
  }
};
