import { apple, getApplePublicKey } from "./apple.mjs";
import { atlassian } from "./atlassian.mjs";
import { cognito, getCognitoPublicKey } from "./cognito.mjs";
import { discord } from "./discord.mjs";
import { dropbox } from "./dropbox.mjs";
import { facebook } from "./facebook.mjs";
import { figma } from "./figma.mjs";
import { github } from "./github.mjs";
import { gitlab } from "./gitlab.mjs";
import { getGooglePublicKey, google } from "./google.mjs";
import { huggingface } from "./huggingface.mjs";
import { kakao } from "./kakao.mjs";
import { kick } from "./kick.mjs";
import { line } from "./line.mjs";
import { linear } from "./linear.mjs";
import { linkedin } from "./linkedin.mjs";
import { getMicrosoftPublicKey, microsoft } from "./microsoft-entra-id.mjs";
import { naver } from "./naver.mjs";
import { notion } from "./notion.mjs";
import { paybin } from "./paybin.mjs";
import { paypal } from "./paypal.mjs";
import { polar } from "./polar.mjs";
import { railway } from "./railway.mjs";
import { reddit } from "./reddit.mjs";
import { roblox } from "./roblox.mjs";
import { salesforce } from "./salesforce.mjs";
import { slack } from "./slack.mjs";
import { spotify } from "./spotify.mjs";
import { tiktok } from "./tiktok.mjs";
import { twitch } from "./twitch.mjs";
import { twitter } from "./twitter.mjs";
import { vercel } from "./vercel.mjs";
import { vk } from "./vk.mjs";
import { wechat } from "./wechat.mjs";
import { zoom } from "./zoom.mjs";
import * as z from "zod";
//#region src/social-providers/index.ts
const socialProviders = {
	apple,
	atlassian,
	cognito,
	discord,
	facebook,
	figma,
	github,
	microsoft,
	google,
	huggingface,
	slack,
	spotify,
	twitch,
	twitter,
	dropbox,
	kick,
	linear,
	linkedin,
	gitlab,
	tiktok,
	reddit,
	roblox,
	salesforce,
	vk,
	zoom,
	notion,
	kakao,
	naver,
	line,
	paybin,
	paypal,
	polar,
	railway,
	vercel,
	wechat
};
const socialProviderList = Object.keys(socialProviders);
const SocialProviderListEnum = z.enum(socialProviderList).or(z.string());
//#endregion
export { SocialProviderListEnum, apple, atlassian, cognito, discord, dropbox, facebook, figma, getApplePublicKey, getCognitoPublicKey, getGooglePublicKey, getMicrosoftPublicKey, github, gitlab, google, huggingface, kakao, kick, line, linear, linkedin, microsoft, naver, notion, paybin, paypal, polar, railway, reddit, roblox, salesforce, slack, socialProviderList, socialProviders, spotify, tiktok, twitch, twitter, vercel, vk, wechat, zoom };
