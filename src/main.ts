import * as nip19 from 'nostr-tools/nip19';
import { finalizeEvent } from 'nostr-tools/pure';
import { SimplePool } from 'nostr-tools/pool';
import { readFileSync, writeFileSync } from 'node:fs';
import { AppBskyFeedPost, AtpAgent, RichText } from '@atproto/api';
import { Client } from '@concurrent-world/client';
import Parser from 'rss-parser';

const isDebug = false;

(async () => {
  const saveFileName = 'save.json';
  const obj = JSON.parse(readFileSync(saveFileName, 'utf8'));
  const latestTime = obj.latestTime;
  const NOSTR_PRIVATE_KEY = process.env.NOSTR_PRIVATE_KEY ?? '';
  const BLUESKY_IDENTIFIER = process.env.BLUESKY_IDENTIFIER ?? '';
  const BLUESKY_PASSWORD = process.env.BLUESKY_PASSWORD ?? '';
  const CONCRNT_SUBKEY = process.env.CONCRNT_SUBKEY ?? '';
  const [message, latestTimeNew, urls] = await getMessage(
    obj.rssUrl,
    obj.hashTag,
    latestTime,
  );
  if (message !== '') {
    if (!isDebug) {
      const { type, data } = nip19.decode(NOSTR_PRIVATE_KEY);
      if (type !== 'nsec') {
        console.warn('NOSTR_PRIVATE_KEY is not nsec');
        return;
      }
      const sk: Uint8Array = data;
      await postNostr(sk, message, obj.relays, urls, obj.hashTag);
      await postBluesky(BLUESKY_IDENTIFIER, BLUESKY_PASSWORD, message);
      await postConcrnt(obj.targetStream, CONCRNT_SUBKEY, message);
    } else {
      console.log('message length: ', message.length);
    }
    console.log('post complete');
    obj.latestTime = latestTimeNew;
    if (!isDebug) {
      writeFileSync(saveFileName, JSON.stringify(obj, null, 2) + '\n');
    }
    console.log('save complete');
    process.exit(0);
  } else {
    console.log('not updated.');
  }

  // Nostrに投稿
  async function postNostr(
    sk: Uint8Array,
    message: string,
    relays: string[],
    urls: string[],
    hashTag: string,
  ) {
    const pool = new SimplePool();
    const tags = [
      ['t', hashTag],
      ...urls.map((url) => ['r', url]),
      ['proxy', obj.webUrl, 'web'],
    ];
    const unsignedEvent = {
      kind: 1,
      created_at: Math.floor(Date.now() / 1000),
      tags: tags,
      content: message,
    };
    const signedEvent = finalizeEvent(unsignedEvent, sk);
    const pubs = pool.publish(relays, signedEvent);
    await Promise.allSettled(pubs);
    pool.close(relays);
  }

  // Blueskyに投稿
  async function postBluesky(
    identifier: string,
    password: string,
    text: string,
  ) {
    const agent = new AtpAgent({ service: 'https://bsky.social' });
    await agent.login({
      identifier,
      password,
    });
    const rt = new RichText({ text });
    await rt.detectFacets(agent);
    const postRecord: AppBskyFeedPost.Record = {
      $type: 'app.bsky.feed.post',
      text: rt.text,
      facets: rt.facets,
      createdAt: new Date().toISOString(),
    };
    const res = await agent.post(postRecord);
    console.log(res);
  }

  // Concrntに投稿
  async function postConcrnt(
    targetStream: string,
    subkey: string,
    body: string,
  ) {
    const client = await Client.createFromSubkey(subkey);
    if (client.user === null) {
      console.warn('client.user is null');
      return;
    }
    await client.createMarkdownCrnt(body, [
      client.user.homeTimeline,
      targetStream,
    ]);
  }

  // RSSを見に行って新着情報を取得
  async function getMessage(
    rssUrl: string,
    hashTag: string,
    latestTime: number,
  ): Promise<[string, number, string[]]> {
    const parser = new Parser();
    let latestTimeNew = latestTime;
    const urls: Set<string> = new Set();
    const messagePre: Set<string> = new Set();
    const message: Set<string> = new Set();
    const feed = await parser.parseURL(rssUrl);
    for (const item of feed.items.reverse()) {
      const pubDateStr: string = item.pubDate ?? '';
      const pubDate: number = Date.parse(pubDateStr) / 1000;
      if (pubDate > latestTime) {
        const dateTime: Date = new Date((pubDate + 9 * 60 * 60) * 1000);
        const entry = [];
        entry.push(item.title);
        entry.push(dateTime.toLocaleString('ja-JP'));
        entry.push(item.link);
        entry.push('');
        messagePre.add(entry.join('\n'));
        if (Array.from(messagePre).join('\n').length > 280) break;
        message.add(entry.join('\n'));
        if (item.link) urls.add(item.link);
      }
      if (latestTimeNew < pubDate) {
        latestTimeNew = pubDate;
      }
    }
    if (message.size !== 0) {
      message.add('#' + hashTag);
      console.log(Array.from(message).join('\n'));
    }
    console.log('latestTime: ', latestTime);
    console.log('latestTimeNew: ', latestTimeNew);
    return [Array.from(message).join('\n'), latestTimeNew, Array.from(urls)];
  }
})();
