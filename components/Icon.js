// Simple line icons (ClickUp-like): one stroke weight, rounded ends, currentColor.
const P = {
  calendar: 'M4 6.5h16v13H4zM4 10h16M8.5 4v4M15.5 4v4',
  bell: 'M6.5 16.5V11a5.5 5.5 0 0111 0v5.5l1.5 2h-14zM10 20.5a2 2 0 004 0',
  repeat: 'M5 10V9a3 3 0 013-3h10l-3-3M19 14v1a3 3 0 01-3 3H6l3 3',
  tag: 'M4 4h7.5L20 12.5 12.5 20 4 11.5zM8.2 8.2h.01',
  user: 'M12 12a4 4 0 100-8 4 4 0 000 8zM4.5 20.5a7.5 7.5 0 0115 0',
  users: 'M9 11a3.5 3.5 0 100-7 3.5 3.5 0 000 7zM2.5 20a6.5 6.5 0 0113 0M16 4.5a3.5 3.5 0 010 6.5M18 14.2a6.5 6.5 0 013.5 5.8',
  flag: 'M5.5 21V4M5.5 4.5h11l-2.5 4 2.5 4h-11',
  note: 'M6 3.5h8.5L19 8v12.5H6zM14 3.5V8.5h5M9 12.5h6M9 16h6',
  check: 'M5 12.5l4.5 4.5L19 7.5',
  checklist: 'M4 6.5l1.5 1.5L8 5.5M4 12.5l1.5 1.5L8 11.5M4 18.5l1.5 1.5L8 17.5M11 7h9M11 13h9M11 19h9',
  circle: 'M12 20.5a8.5 8.5 0 100-17 8.5 8.5 0 000 17z',
  half: 'M12 20.5a8.5 8.5 0 100-17 8.5 8.5 0 000 17zM12 3.5v17',
  plus: 'M12 5v14M5 12h14',
  clip: 'M16.5 7.5l-7 7a2.5 2.5 0 003.5 3.5l7.5-7.5a4.5 4.5 0 00-6.4-6.4L6.4 11.8a6.5 6.5 0 009.2 9.2l5-5',
  mic: 'M9 6a3 3 0 016 0v5a3 3 0 01-6 0zM5.5 11a6.5 6.5 0 0013 0M12 17.5V21',
  camera: 'M4 8h3l2-2.5h6L17 8h3v11H4zM12 16.5a3.5 3.5 0 100-7 3.5 3.5 0 000 7z',
  more: 'M12 5.5h.01M12 12h.01M12 18.5h.01',
  back: 'M15 5l-7 7 7 7',
  share: 'M12 15V4M7.5 8.5L12 4l4.5 4.5M5 13v6h14v-6',
  send: 'M4 12l16-8-6 16-2.5-6.5z',
  search: 'M11 17.5a6.5 6.5 0 100-13 6.5 6.5 0 000 13zM16 16l4.5 4.5',
  trash: 'M5 7h14M9.5 7V4.5h5V7M7 7l1 13h8l1-13',
  edit: 'M4 20h4L19 9l-4-4L4 16zM13.5 6.5l4 4',
  link: 'M10 14a4 4 0 005.7 0l3-3a4 4 0 00-5.7-5.7l-1 1M14 10a4 4 0 00-5.7 0l-3 3a4 4 0 005.7 5.7l1-1',
  brain: 'M9 4.5a3 3 0 00-3 3 3 3 0 00-1.5 5.3A3 3 0 007 18a3 3 0 005 1.5V5.5A3 3 0 009 4.5zM15 4.5a3 3 0 013 3 3 3 0 011.5 5.3A3 3 0 0117 18a3 3 0 01-5 1.5',
  sparkle: 'M12 3.5l1.8 5 5 1.8-5 1.8-1.8 5-1.8-5-5-1.8 5-1.8zM18.5 16l.7 1.8 1.8.7-1.8.7-.7 1.8-.7-1.8-1.8-.7 1.8-.7z',
  file: 'M6 3.5h8.5L19 8v12.5H6zM14 3.5V8.5h5',
  image: 'M4 5h16v14H4zM4 16l4.5-4.5 4 4 2.5-2.5L20 18M15.5 9.5h.01',
  close: 'M6 6l12 12M18 6L6 18',
  globe: 'M12 20.5a8.5 8.5 0 100-17 8.5 8.5 0 000 17zM3.5 12h17M12 3.5c2.5 2.5 3.5 5.3 3.5 8.5s-1 6-3.5 8.5c-2.5-2.5-3.5-5.3-3.5-8.5s1-6 3.5-8.5z',
};

export default function Icon({ name, size = 18, className = '', strokeWidth = 1.8 }) {
  const fill = name === 'send' ? 'currentColor' : 'none';
  const dots = name === 'more';
  return (
    <svg className={`ico ${className}`} viewBox="0 0 24 24" width={size} height={size} aria-hidden="true">
      <path d={P[name] || ''} fill={fill} stroke="currentColor" strokeWidth={dots ? 3.2 : strokeWidth} strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
