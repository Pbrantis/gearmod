const fs=require('fs');let s=fs.readFileSync('AgentPermissions.tsx','utf8');const crlf=s.includes('\r\n');s=s.replace(/\r\n/g,'\n');
const i=s.indexOf('function PermissionAction');
if(i<0)throw new Error('x');
s=s.slice(0,i)+fs.readFileSync('_p1.tmp','utf8');
s=s.replace("import type { AgentPermission } from '@agentboard/contracts'","import type { AgentPermission } from '@agentboard/contracts'\nimport { explainCommand, riskLabel, shortPath, type Risk } from './permissionExplain'");
s=s.replace(`<article className="msg system" key={request.id}>
    <b>{request.provider === 'claude' ? 'Claude' : 'Codex'} pede permissão</b>
    <PermissionAction request={request} />
    <div className="cx-actions">`,`<article className="msg system perm" key={request.id}>
    <PermissionAction request={request} />
    <div className="cx-actions">`);
fs.writeFileSync('AgentPermissions.tsx',crlf?s.replace(/\n/g,'\r\n'):s);
