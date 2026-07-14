import {getSupabaseBrowserClient,isSupabaseConfigured} from "@/lib/supabase/client";

export type Season="spring"|"summer"|"autumn"|"winter";
export type SeasonMode="auto"|"manual";
export type SeasonThemeConfig={mode:SeasonMode;season:Season;effectiveSeason:Season;updatedAt?:string};
export const SEASON_THEME_EVENT="damasio:season-theme";
const KEY="damasio_platform_season_theme";

export function automaticSeason(date=new Date()):Season{const month=date.getMonth()+1;if(month>=3&&month<=5)return"spring";if(month>=6&&month<=8)return"summer";if(month>=9&&month<=11)return"autumn";return"winter"}
export function resolveSeason(config:Pick<SeasonThemeConfig,"mode"|"season">):Season{return config.mode==="auto"?automaticSeason():config.season}
export function readLocalSeasonTheme():SeasonThemeConfig{if(typeof window==="undefined")return{mode:"auto",season:"summer",effectiveSeason:automaticSeason()};try{const value=JSON.parse(localStorage.getItem(KEY)||"{}");const mode:SeasonMode=value.mode==="manual"?"manual":"auto";const season:Season=["spring","summer","autumn","winter"].includes(value.season)?value.season:"summer";return{mode,season,effectiveSeason:resolveSeason({mode,season}),updatedAt:value.updatedAt}}catch{return{mode:"auto",season:"summer",effectiveSeason:automaticSeason()}}}
export function saveLocalSeasonTheme(mode:SeasonMode,season:Season){const config:SeasonThemeConfig={mode,season,effectiveSeason:resolveSeason({mode,season}),updatedAt:new Date().toISOString()};localStorage.setItem(KEY,JSON.stringify(config));window.dispatchEvent(new CustomEvent(SEASON_THEME_EVENT,{detail:config}));return config}
export async function loadSeasonTheme():Promise<SeasonThemeConfig>{if(isSupabaseConfigured())try{const client=getSupabaseBrowserClient() as any;const{data,error}=await client.rpc("get_platform_season_theme");if(!error&&data){const row=Array.isArray(data)?data[0]:data;if(row){const mode:SeasonMode=row.season_mode==="manual"?"manual":"auto";const season:Season=row.season||"summer";return saveLocalSeasonTheme(mode,season)}}}catch{}return readLocalSeasonTheme()}
export async function updateSeasonTheme(mode:SeasonMode,season:Season){const local=saveLocalSeasonTheme(mode,season);if(isSupabaseConfigured())try{const client=getSupabaseBrowserClient() as any;const{error}=await client.rpc("set_platform_season_theme",{p_mode:mode,p_season:season});if(error)throw new Error(error.message)}catch(error){throw error}return local}
