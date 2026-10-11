import {readFile} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';


const HEX_SHA=/^[0-9a-f]{40}$/;
export function assertFinalBuildIdentity({checkoutSha,eventSha,tagCommitSha}={}){
 if(![checkoutSha,eventSha,tagCommitSha].every(s=>typeof s==='string'&&HEX_SHA.test(s)))
  throw new Error('Final Windows source identity requires three valid Git commit SHA values');
 if(checkoutSha!==eventSha||checkoutSha!==tagCommitSha)
  throw new Error('Final Windows tag commit SHA differs from checkout or Actions event');
 return checkoutSha;
}
function resolveGitCommit(revision){
 const result=spawnSync('git',['rev-parse','--verify',revision],{
  cwd:fileURLToPath(new URL('..',import.meta.url)),encoding:'utf8',windowsHide:true,
  maxBuffer:4096,timeout:5000,
 });
 if(result.error||result.status!==0||!result.stdout.trim())
  throw new Error('Unable to verify the final tag and checkout against Git');
 return result.stdout.trim();
}

const stableVersion=/^(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)$/;

/**
 * Never create temporary/preview installers from an Alpha or mutable branch.
 * A release tag is REQUIRED but is NOT proof of completion of RG-01..09.
 * This guard only authorizes starting the separate final packaging workflow;
 * it does not publish any artifacts or declare the application Stable.
 */
export function assertFinalBuildAuthorization({ref,eventName,packageVersion}={}){
 if(eventName!=='workflow_dispatch')
  throw new Error('Final Windows packaging requires an explicit manual workflow dispatch');
 if(typeof packageVersion!=='string'||!stableVersion.test(packageVersion))
  throw new Error('Final Windows packaging refuses prerelease or invalid application version');
 if(typeof ref!=='string'||ref!==`refs/tags/v${packageVersion}`)
  throw new Error('Final Windows packaging requires the matching immutable release tag ref');
 return Object.freeze({version:packageVersion,ref,finalTagOnly:true});
}

async function authorizeCurrentWorkflow(){
 // Package version is always read from the checked-out source, never a
 // manually typed VERSION input or a renderer/browser-provided value.
 const root=new URL('../package.json',import.meta.url);
 const manifest=JSON.parse(await readFile(root,'utf8'));
 const permitted=assertFinalBuildAuthorization({
  ref:process.env.USSHM_BUILD_REF,
  eventName:process.env.USSHM_BUILD_EVENT,
  packageVersion:manifest.version,
 });
 assertFinalBuildIdentity({
  checkoutSha:resolveGitCommit('HEAD'),
  eventSha:process.env.USSHM_BUILD_SHA,
  tagCommitSha:resolveGitCommit('refs/tags/v'+permitted.version+'^{commit}'),
 });
 process.stdout.write(`Authorized tag-only Windows packaging for ${permitted.ref}. RG-01..09 still require independent evidence.\n`);
}

if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 authorizeCurrentWorkflow().catch(error=>{
  process.stderr.write('Windows release packaging blocked: '+
   (error instanceof Error?error.message:'unknown authorization error')+'\n');
  process.exitCode=1;
 });
}
