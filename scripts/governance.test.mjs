import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { git } from "./catalog-source.mjs";
import { currentApprovers } from "./reviews.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const resource = "skills/example";
function run(t, {files, author="submitter", admins="admin", approvers="", owner="submitter", registeredOwner=owner, base, custom}) {
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),"market-governance-"));
  t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  const candidate=path.join(dir,"candidate"), pkg=path.join(candidate,resource);
  fs.mkdirSync(pkg,{recursive:true});
  const manifest={id:resource,schema_version:"1.0",market_group:"gear",type:"skill",version:"1.0.0",name:"Example",summary:"Example",owner_github:owner,
    license:"MIT",permissions:{shell:false,network:false,filesystem:"none"},entrypoints:{readme:"readme.md"},industries:["i"],positions:[]};
  fs.writeFileSync(path.join(pkg,"manifest.json"),JSON.stringify(manifest));
  fs.writeFileSync(path.join(pkg,"readme.md"),"Example");
  fs.writeFileSync(path.join(candidate,"taxonomy.json"),JSON.stringify({version:"1",positions:[{code:"p"}],industries:[{code:"i"}]}));
  fs.writeFileSync(path.join(dir,"owners.json"),JSON.stringify(registeredOwner ? {[resource]:registeredOwner} : {}));
  fs.writeFileSync(path.join(dir,"changed"),(files||[resource+"/readme.md"]).join("\0")+"\0");
  if (base) {
    // Git objects exist only in this test's temporary candidate repository.
    git(candidate, ["init", "-q"]);
    git(candidate, ["config", "user.name", "Fixture"]);
    git(candidate, ["config", "user.email", "fixture@example.test"]);
    const snapshot = (parents = []) => {
      git(candidate, ["add", "-A"]);
      const tree = git(candidate, ["write-tree"]).trim();
      const commit = git(candidate, ["commit-tree", tree, ...parents, "-m", "Fixture"]).trim();
      git(candidate, ["update-ref", "HEAD", commit]);
    };
    if (base.rollbacks) fs.writeFileSync(path.join(candidate,"rollbacks.json"),JSON.stringify(base.rollbacks));
    snapshot();
    if (base.delist) {
      fs.rmSync(pkg, {recursive:true});
      snapshot(["-p","HEAD"]);
      git(candidate, ["restore","--source=HEAD^","--",resource]);
    }
  }
  custom?.(pkg,candidate);
  const res=spawnSync(process.execPath,[path.join(root,"scripts/validate.mjs"),"--root",candidate,
    "--owners-file",path.join(dir,"owners.json"),"--pr-files",path.join(dir,"changed"),
    ...(base ? ["--base-ref","HEAD"] : []),
    "--pr-author",author,"--admins",admins,"--approvers",approvers],{encoding:"utf8"});
  return {ok:res.status===0,output:res.stdout+res.stderr};
}
test("official packages require a team representative and a distinct admin",t=>{
  const team = {owner:"official", admins:"admin,reviewer"};
  assert.equal(run(t,{...team, admins:"", approvers:"admin"}).ok,false);
  assert.equal(run(t,{...team, author:"admin", approvers:"admin"}).ok,false);
  assert.equal(run(t,{...team, author:"admin", approvers:"reviewer"}).ok,true);
  assert.match(run(t,{...team, approvers:"admin,ADMIN,submitter"}).output,/两名不同的 Admin/);
  assert.match(run(t,{...team, author:"official", approvers:"admin,official"}).output,/两名不同的 Admin/);
  assert.equal(run(t,{...team, approvers:"admin,reviewer"}).ok,true);
});
test("only an administrator can register a new package with the reserved official owner",t=>{
  const team = {owner:"official", registeredOwner:null, admins:"admin,reviewer"};
  assert.match(run(t,{...team, author:"official", approvers:"admin,reviewer"}).output,/只有管理员可登记 official/);
  assert.equal(run(t,{...team, author:"admin", approvers:"reviewer"}).ok,true);
});
test("ordinary owners and administrators are independently confirmed",t=>{
  assert.equal(run(t,{owner:"artist",approvers:"admin"}).ok,false);
  assert.equal(run(t,{owner:"artist",approvers:"artist"}).ok,false);
  assert.equal(run(t,{owner:"artist",approvers:"artist,admin"}).ok,true);
  assert.equal(run(t,{owner:"artist",author:"artist",approvers:"admin"}).ok,true);
  assert.equal(run(t,{owner:"artist",admins:"artist,admin",approvers:"artist"}).ok,false);
  const deletion = {owner:"artist",custom:pkg=>fs.rmSync(pkg,{recursive:true})};
  assert.match(run(t,{...deletion,approvers:"admin"}).output,/原创建者 @artist/);
  assert.equal(run(t,{...deletion,approvers:"artist,admin"}).ok,true);
});
test("submissions cannot change shared files; rule maintenance has its own reviewed PR",t=>{
  const content = resource + "/readme.md";
  for (const shared of ["taxonomy.json","README.md",".github/workflows/pr-validate.yml","scripts/validate.mjs","manifest.json","owners.json","docs/guide.md"]) {
    const result = run(t,{files:[content,shared],approvers:"admin"});
    assert.equal(result.ok,false,shared);
    assert.match(result.output,/投稿内容和共享文件应分别提交/);
  }
  const maintenance = ["README.md","taxonomy.json",".github/workflows/pr-validate.yml"];
  assert.equal(run(t,{files:maintenance,approvers:"admin"}).ok,true);
  assert.equal(run(t,{files:maintenance,approvers:""}).ok,false);
  assert.equal(run(t,{files:[content,"taxonomy.json"],author:"admin",admins:"admin,reviewer",approvers:"reviewer"}).ok,false);
  for (const generated of ["manifest.json","owners.json"]) {
    assert.match(run(t,{files:[generated],author:"admin",admins:"admin,reviewer",approvers:"reviewer"}).output,/禁止在 PR 中手工修改/);
  }
});
test("ordinary submissions stay in one package and new packages belong to the PR author",t=>{
  assert.match(run(t,{files:[resource+"/readme.md","skills/second/readme.md"],approvers:"admin"}).output,/只能修改一个资源目录/);
  for (const stray of ["skills/loose.txt","skills/.hidden/manifest.json"]) {
    assert.match(run(t,{files:[stray],approvers:"admin"}).output,/有效的 <category>\/<slug>\//);
  }
  assert.equal(run(t,{registeredOwner:null,owner:"submitter",approvers:"admin"}).ok,true);
  assert.match(run(t,{registeredOwner:null,owner:"artist",approvers:"admin"}).output,/必须与 PR 提交者/);
  assert.match(run(t,{registeredOwner:null,author:"",approvers:"admin"}).output,/缺少当前 PR 提交者/);
});
test("current and delisted packages retain their last reviewed owner when the generated map omits them",t=>{
  for (const delist of [false,true]) {
    const options={owner:"artist",registeredOwner:null,base:{delist}};
    const denied=run(t,{...options,approvers:"admin"});
    assert.equal(denied.ok,false);
    assert.match(denied.output,/原创建者 @artist/);
    assert.equal(run(t,{...options,approvers:"artist,admin"}).ok,true);
    const takeover=run(t,{...options,approvers:"artist,admin",custom:pkg=>{
      const file=path.join(pkg,"manifest.json");
      const manifest=JSON.parse(fs.readFileSync(file,"utf8"));
      fs.writeFileSync(file,JSON.stringify({...manifest,owner_github:"submitter"}));
    }});
    assert.match(takeover.output,/禁止擅自变更 owner_github/);
  }
});
test("rollback edits require a maintainer, matching package changes and independent approval",t=>{
  const files=[resource+"/manifest.json","rollbacks.json"];
  assert.match(run(t,{files,approvers:"admin"}).output,/必须由管理员随对应资源/);
  const admin={owner:"artist",author:"admin",admins:"admin,reviewer",approvers:"artist,reviewer"};
  assert.match(run(t,{...admin,files:["rollbacks.json"]}).output,/必须由管理员随对应资源/);
  const intent={from_version:"2.0.0",to_version:"1.0.0",reason:"compat"};
  const writeIntent=id=>(_pkg,candidate)=>fs.writeFileSync(path.join(candidate,"rollbacks.json"),JSON.stringify({[id]:intent}));
  assert.equal(run(t,{...admin,files,base:{},custom:writeIntent(resource)}).ok,true);
  assert.match(run(t,{...admin,files,base:{},approvers:"reviewer",custom:writeIntent(resource)}).output,/原创建者 @artist/);
  assert.match(run(t,{...admin,files,base:{rollbacks:{"skills/other":intent}},custom:writeIntent(resource)}).output,/skills\/other: 回退声明只能随对应资源/);
});
test("package symlinks stay inside the package",t=>{
  const checked=run(t,{approvers:"admin",custom:pkg=>fs.symlinkSync("../outside",path.join(pkg,"asset"))});
  assert.equal(checked.ok,false);
  assert.match(checked.output,/符号链接必须位于资源包内/);
});
test("approvals belong to the current head and reflect each reviewer's latest decision",()=>{
  const review=(id,login,state,commit_id)=>({id,user:{login},state,commit_id});
  const reviews=[review(1,"alice","APPROVED","old"),review(2,"bob","APPROVED","current"),review(3,"bob","DISMISSED","current"),
    review(4,"ADMIN","APPROVED","current"),review(5,"admin","COMMENTED","current"),review(6,"carol","CHANGES_REQUESTED","current")];
  assert.deepEqual(currentApprovers(reviews,"current"),["admin"]);
});

