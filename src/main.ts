import Parser from 'rss-parser';
import {
	getPublicKey,
	SimplePool,
	getEventHash,
	signEvent,
	nip19,
	Event,
	Pub
} from 'nostr-tools';
import 'websocket-polyfill';
import {
	AppBskyFeedPost,
	BskyAgent,
	RichText
} from '@atproto/api';

const isDbug = false;

(async() => {
	const saveFileName = 'save.json';
	const fs = require('fs');
	const obj = JSON.parse(fs.readFileSync(saveFileName, 'utf8'));
	const hashTag = obj.hashTag;
	const rssUrl = obj.rssUrl;
	const latestTime = obj.latestTime;
	const relaysdef = obj.relays;
	const NOSTR_PRIVATE_KEY = process.env.NOSTR_PRIVATE_KEY ?? '';
	const BLUESKY_IDENTIFIER = process.env.BLUESKY_IDENTIFIER ?? '';
	const BLUESKY_PASSWORD = process.env.BLUESKY_PASSWORD ?? '';
	const [message, latestTimeNew, urls] = await getMessage();
	if (message !== '') {
		if (!isDbug) {
			const {type, data} = nip19.decode(NOSTR_PRIVATE_KEY);
			const sk: string = typeof data === 'string' ? data : '';
			await postNostr(sk, message, relaysdef, urls);
			await postBluesky(BLUESKY_IDENTIFIER, BLUESKY_PASSWORD, message);
		}
		else {
			console.log('message length: ', message.length);
		}
		console.log('post complete');
		obj.latestTime = latestTimeNew;
		if (!isDbug) {
			fs.writeFileSync(saveFileName, JSON.stringify(obj, null, '\t'));
		}
		console.log('save complete');
	}
	else {
		console.log('not updated.');
	}

	// Nostrに投稿
	async function postNostr(sk: string, message: string, relays: string[], urls: string[]) {
		const pool = new SimplePool({eoseSubTimeout: 60, getTimeout: 60});
		const connectedRelays = [];
		for (const relay of relays) {
			try {
				connectedRelays.push(relay);
				console.log('ensureRelay OK: ' + relay);
			} catch (error) {
				console.log('ensureRelay error: ' + relay, error);
				pool.close(connectedRelays);
				return;
			}
		}
		const pk = getPublicKey(sk);
		const tags = [['t', hashTag]];
		for (const url of urls) {
			tags.push(['r', url]);
		}
		const event: Event = {
			kind: 1,
			pubkey: pk,
			created_at: Math.floor(Date.now() / 1000),
			tags: tags,
			content: message,
			id: '',
			sig: ''
		};
		event.id = getEventHash(event);
		event.sig = signEvent(event, sk);
		const pubs: Pub = pool.publish(relays, event);
		let count = 0;
		pubs.on('ok', () => {
			count++;
			if (count >= relays.length) {
				pool.close(relays);
			}
		});
		pubs.on('failed', (reason: any) => {
			count++;
			if (count >= relays.length) {
				pool.close(relays);
			}
		});
	}

	// Blueskyに投稿
	async function postBluesky(identifier: string, password:string, text: string) {
		const agent = new BskyAgent({service: 'https://bsky.social'});
		await agent.login({
			identifier,
			password
		});
		const rt = new RichText({text});
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

	// RSSを見に行って新着情報を取得
	async function getMessage() {
		const parser = new Parser();
		let latestTimeNew = latestTime;
		const urls: Set<any> = new Set();
		const messagePre = new Set();
		const message = new Set();
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
				if (Array.from(messagePre).join('\n').length > 280)
					break;
				message.add(entry.join('\n'));
				urls.add(item.link);
			}
			if (latestTimeNew < pubDate) {
				latestTimeNew = pubDate;
			}
		}
		if (message.size != 0) {
			message.add('#' + hashTag);
			console.log(Array.from(message).join('\n'));
		}
		console.log('latestTime: ', latestTime);
		console.log('latestTimeNew: ', latestTimeNew);
		return [Array.from(message).join('\n'), latestTimeNew, Array.from(urls)];
	}
})();
