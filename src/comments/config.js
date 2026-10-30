export const GITHUB = {
  owner: 'Nanum-Learn',
  repo: 'website-comments',
  category: 'comments',
};

export const SITES = new Map([
  ['nanumlearn', {
    origin: 'https://nanumlearn.enochyu.com',
    threads: '/comment-threads.json',
    reserved: ['enochyu', 'williamkang', 'jianchoi', 'nanumlearn', 'admin', 'moderator', 'maintainer', 'verified'],
  }],
]);

export const LEADERSHIP = new Map([
  [247741827, 'Enoch Yu'],
]);

export const LIMITS = {
  bodyBytes: 8192,
  name: 40,
  text: 2000,
  links: 2,
  pathLength: 200,
  tokenLength: 2048,
  ipGapSeconds: 20,
  ipPerHour: 10,
  allPerHour: 60,
  pauseSeconds: 600,
  readCacheSeconds: 30,
  manifestCacheSeconds: 300,
  commentPages: 5,
  discussionPages: 10,
};
