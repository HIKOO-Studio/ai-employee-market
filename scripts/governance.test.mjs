import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { currentApprovers } from "./reviews.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
function run(t, {files, author="submitter", admins="admin", approvers="", owner="official", custom}) {
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),"market-governance-"));
  t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  const resource="skills/example";
  const candidate=path.join(dir,"candidate"), pkg=path.join(candidate,resource);
  fs.mkdirSync(pkg,{recursive:true});
  const manifest={id:resource,schema_version:"1.0",market_group:"gear",type:"skill",version:"1.0.0",name:"Example",summary:"Example",owner_github:owner};
  fs.writeFileSync(path.join(pkg,"manifest.json"),JSON.stringify(manifest));
  fs.writeFileSync(path.join(pkg,"readme.md"),"Example");
  fs.writeFileSync(path.join(pkg,"SKILL.md"),"---\nname: example\ndescription: Example skill for governance tests\n---\n\n# Example Skill\n");
  fs.writeFileSync(path.join(candidate,"taxonomy.json"),JSON.stringify({version:"1",positions:[{code:"p"}],industries:[{code:"i"}]}));
  fs.writeFileSync(path.join(dir,"owners.json"),JSON.stringify({[resource]:owner}));
  fs.writeFileSync(path.join(dir,"changed"),(files||[resource+"/readme.md"]).join("\0")+"\0");
  custom?.(pkg);
  const res=spawnSync(process.execPath,[path.join(root,"scripts/validate.mjs"),"--root",candidate,
    "--owners-file",path.join(dir,"owners.json"),"--pr-files",path.join(dir,"changed"),
    "--pr-author",author,"--admins",admins,"--approvers",approvers],{encoding:"utf8"});
  return {ok:res.status===0,output:res.stdout+res.stderr};
}
test("market approvals fail closed; official seeds use an independent actual administrator review",t=>{
  assert.equal(run(t,{admins:"",approvers:"admin"}).ok,false);
  assert.equal(run(t,{author:"admin",approvers:"admin"}).ok,false);
  assert.equal(run(t,{author:"submitter",approvers:"admin"}).ok,true);
  assert.equal(run(t,{author:"admin",admins:"admin,reviewer",approvers:"reviewer"}).ok,true);
});
test("ordinary owners and administrators are independently confirmed",t=>{
  assert.equal(run(t,{owner:"artist",approvers:"admin"}).ok,false);
  assert.equal(run(t,{owner:"artist",approvers:"artist"}).ok,false);
  assert.equal(run(t,{owner:"artist",approvers:"artist,admin"}).ok,true);
  assert.equal(run(t,{owner:"artist",author:"artist",approvers:"admin"}).ok,true);
  assert.equal(run(t,{owner:"artist",admins:"artist,admin",approvers:"artist"}).ok,false);
});
test("rule edits must be reviewed separately; package symlinks stay inside package",t=>{
  assert.equal(run(t,{files:["skills/example/readme.md",".github/workflows/pr-validate.yml"],approvers:"admin"}).ok,false);
  assert.equal(run(t,{files:[".github/workflows/pr-validate.yml"],approvers:"admin"}).ok,true);
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

test("skills must follow Agent Skills SKILL.md standard",t=>{
  const missing=run(t,{approvers:"admin",custom:pkg=>fs.rmSync(path.join(pkg,"SKILL.md"))});
  assert.equal(missing.ok,false);
  assert.match(missing.output,/SKILL\.md/);

  const badFm=run(t,{approvers:"admin",custom:pkg=>fs.writeFileSync(path.join(pkg,"SKILL.md"),"# No frontmatter\n")});
  assert.equal(badFm.ok,false);
  assert.match(badFm.output,/YAML Frontmatter/);
});

test("mcps must provide standard mcp.json and pin versions instead of @latest",t=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),"market-mcp-"));
  t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  const pkg=path.join(dir,"mcps/demo-mcp");
  fs.mkdirSync(pkg,{recursive:true});
  fs.writeFileSync(path.join(dir,"taxonomy.json"),JSON.stringify({version:"1",positions:[{code:"p"}],industries:[{code:"i"}]}));
  fs.writeFileSync(path.join(pkg,"manifest.json"),JSON.stringify({
    id:"mcps/demo-mcp",schema_version:"1.0",market_group:"gear",type:"mcp",
    version:"1.0.0",name:"Demo MCP",summary:"Demo",owner_github:"official"
  }));
  fs.writeFileSync(path.join(pkg,"readme.md"),"# Demo MCP\n");

  const runAll=()=>spawnSync(process.execPath,[path.join(root,"scripts/validate.mjs"),"--root",dir,"--all"],{encoding:"utf8"});

  let res=runAll();
  assert.notEqual(res.status,0);
  assert.match(res.stdout+res.stderr,/mcp\.json/);

  fs.writeFileSync(path.join(pkg,"mcp.json"),JSON.stringify({
    mcpServers:{demo:{command:"npx",args:["-y","@modelcontextprotocol/server-filesystem@latest","${WORKSPACE_DIR}"]}}
  }));
  res=runAll();
  assert.notEqual(res.status,0);
  assert.match(res.stdout+res.stderr,/@latest/);

  fs.writeFileSync(path.join(pkg,"mcp.json"),JSON.stringify({
    mcpServers:{demo:{command:"npx",args:["-y","@modelcontextprotocol/server-filesystem@2025.11.25","${WORKSPACE_DIR}"]}}
  }));
  res=runAll();
  assert.equal(res.status,0);
});

