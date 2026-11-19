-- Which feed is a show's, where Apple's directory has several shows of one name or none under it: the owner's choices
-- on 2026-10-17, made from which candidate feed has the episodes that were played (`podcast_feed_choice`). An empty
-- feed is a show with none worth using. Replaces a choice of the same show, so it can be run again.
INSERT OR REPLACE INTO podcast_feed_choice (show_name, feed_url, note) VALUES
  ('Gadget Lab: Weekly Tech News from WIRED', 'https://feeds.megaphone.fm/CNE6423132305', 'Renamed Uncanny Valley | WIRED; all 50 played episodes are in it'),
  ('Small Doses with Amanda Seales', 'https://www.spreaker.com/show/6509436/episodes/feed', 'Listed as Smart Funny & Black Productions; 22 played episodes match'),
  ('TrueAnon', 'https://www.patreon.com/public-rss/2963533?show=875184', 'Listed as TRUE ANON TRUTH FEED; 20 of 25 played episodes match'),
  ('HTML All The Things - Web Development, Web Design, Small Business', 'https://feed.podbean.com/podcast.htmlallthethings.com/feed.xml', 'Renamed; 4 played episodes match'),
  ('PodRocket - A web development podcast from LogRocket', 'https://feeds.fireside.fm/podrocket/rss', 'Listed as PodRocket; 3 played episodes match'),
  ('Power User with Taylor Lorenz', 'https://anchor.fm/s/ff8b4e30/podcast/rss', 'Listed as Taylor Lorenz''s Power User; 3 played episodes match'),
  ('Revolutionary Left Radio', 'https://rss.libsyn.com/shows/95194/destinations/485908.xml', 'Listed as Rev Left Radio; 7 played episodes match'),
  ('In the Making', 'https://feeds.simplecast.com/IWd_z6c8', 'Adobe''s; all 3 played episodes match, the first hit had none'),
  ('Nice Try!', 'https://feeds.megaphone.fm/nicetry', 'Curbed''s; all 3 played episodes match, the first hit had none'),
  ('Red Scare', 'https://redscarepodcast.libsyn.com/rss', 'The 103-episode feed; none of the 4 played episodes is in it, probably because a feed keeps only its newest'),
  ('Just Desserts', '', 'No feed of Apple''s hits has any of the played episodes'),
  ('The Last Laugh', '', 'No feed of Apple''s hits has any of the played episodes'),
  ('2000 og helvete', '', 'No feed of Apple''s hits has any of the played episodes'),
  ('Fetisha +1 Q&A', '', 'No feed of Apple''s hits has any of the played episodes'),
  ('Terrible, Thanks For Asking', '', 'No feed of Apple''s hits has any of the played episodes'),
  ('Pisces Today', '', 'No feed of Apple''s hits has any of the played episodes'),
  ('Unr3leas3d', '', 'No feed of Apple''s hits has any of the played episodes');
