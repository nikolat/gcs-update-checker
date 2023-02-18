import Parser from 'rss-parser';
import {
	getPublicKey,
	SimplePool,
	getEventHash,
	signEvent,
	nip19,
	Event,
} from 'nostr-tools';
import 'websocket-polyfill';

(async() => {
	const saveFileName = 'save.json';
	const fs = require('fs');
	const obj = JSON.parse(fs.readFileSync(saveFileName, 'utf8'));
	const hashTag = obj.hashTag;
	const rssUrl = obj.rssUrl;
	const latestTime = obj.latestTime;
	const relaysdef = obj.relays;
	const NOSTR_PRIVATE_KEY = process.env.NOSTR_PRIVATE_KEY ? process.env.NOSTR_PRIVATE_KEY : '';
	const {type, data} = nip19.decode(NOSTR_PRIVATE_KEY);
	const sk: string = typeof data === 'string' ? data : '';
	const [message, latestTimeNew] = await getMessage();
	if (message != '') {
		await postNostr(sk, message, relaysdef);
		obj.latestTime = latestTimeNew;
		fs.writeFileSync(saveFileName, JSON.stringify(obj, null, '\t'));
	}
	else {
		console.log('not updated.');
	}

	// Nostrに投稿
	async function postNostr(sk: string, message: string, relays: string[]) {
		const pool = new SimplePool();
		for (let i = 0; i < relays.length; i++) {
			try {
				const relay = await pool.ensureRelay(relays[i]);
			} catch (error) {
				console.log('ensureRelay error: ', error);
			}
		}
		const pk = getPublicKey(sk);
		const event: Event = {
			kind: 1,
			pubkey: pk,
			created_at: Math.floor(Date.now() / 1000),
			tags: [],
			content: message,
			id: '',
			sig: ''
		};
		event.id = getEventHash(event);
		event.sig = signEvent(event, sk);
		const pubs = pool.publish(relays, event);
		let count = 0;
		for (let i = 0; i < pubs.length; i++) {
			const pub = pubs[i];
			pub.on('ok', () => {
				count++;
				if (count >= relays.length) {
					pool.close(relays);
				}
			});
			pub.on('failed', (reason: any) => {
				count++;
				if (count >= relays.length) {
					pool.close(relays);
				}
			});
		}
	}

	// RSSを見に行って新着情報を取得
	async function getMessage() {
		const parser = new Parser();
		let latestTimeNew = latestTime;
		const message = [];
		const feed = await parser.parseURL(rssUrl);
		feed.items.forEach(item => {
			const pubDateStr: string = item.pubDate ? item.pubDate : '';
			const pubDate: number = Date.parse(pubDateStr) / 1000;
			if (pubDate > latestTime) {
				const dateTime: Date = new Date((pubDate + 9 * 60 * 60) * 1000);
				message.push(item.title);
				message.push(dateTime.toLocaleString('ja-JP'));
				message.push(item.link);
				message.push('');
			}
			if (latestTimeNew < pubDate) {
				latestTimeNew = pubDate;
			}
		});
		if (message.length != 0) {
			message.push(hashTag);
			console.log(message.join('\n'));
		}
		console.log('latestTime: ', latestTime);
		console.log('latestTimeNew: ', latestTimeNew);
		return [message.join('\n'), latestTimeNew];
	}
})();
