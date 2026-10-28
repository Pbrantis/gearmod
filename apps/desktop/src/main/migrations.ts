import type Database from 'better-sqlite3'

export interface Migration {
  version: number
  checksum: string
  /** Migração que recria tabelas referenciadas por outras: roda com foreign_keys desligado (fora da transação) e confere as chaves no fim. */
  disableForeignKeys?: boolean
  up(db: Database.Database): void
}

const initialSchema = `
CREATE TABLE projects (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, local_path TEXT NOT NULL UNIQUE,
  base_branch TEXT NOT NULL DEFAULT 'dev', remote_provider TEXT,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE TABLE agent_profiles (
  id TEXT PRIMARY KEY, provider TEXT NOT NULL, label TEXT NOT NULL, scope TEXT NOT NULL,
  config_dir TEXT NOT NULL, executable_path TEXT, enabled INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE TABLE project_agent_profiles (
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  profile_id TEXT NOT NULL REFERENCES agent_profiles(id) ON DELETE CASCADE,
  allowed INTEGER NOT NULL DEFAULT 1, PRIMARY KEY(project_id, profile_id)
);
CREATE TABLE board_columns (
  id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  label TEXT NOT NULL, sort_order INTEGER NOT NULL, semantic_state TEXT NOT NULL,
  is_default INTEGER NOT NULL DEFAULT 0, UNIQUE(project_id, semantic_state)
);
CREATE TABLE cards (
  id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  column_id TEXT NOT NULL REFERENCES board_columns(id), type TEXT NOT NULL, title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '', priority TEXT NOT NULL, order_key REAL NOT NULL,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL, archived_at TEXT
);
CREATE TABLE card_acceptance_criteria (
  id TEXT PRIMARY KEY, card_id TEXT NOT NULL REFERENCES cards(id) ON DELETE CASCADE,
  body TEXT NOT NULL, checked INTEGER NOT NULL DEFAULT 0, sort_order INTEGER NOT NULL
);
CREATE TABLE card_tags (card_id TEXT NOT NULL REFERENCES cards(id) ON DELETE CASCADE, tag TEXT NOT NULL, PRIMARY KEY(card_id, tag));
CREATE TABLE card_attachments (
  id TEXT PRIMARY KEY, card_id TEXT NOT NULL REFERENCES cards(id) ON DELETE CASCADE,
  file_name TEXT NOT NULL, relative_path TEXT NOT NULL, media_type TEXT, size_bytes INTEGER NOT NULL,
  checksum TEXT NOT NULL, created_at TEXT NOT NULL
);
CREATE TABLE plans (
  id TEXT PRIMARY KEY, card_id TEXT NOT NULL REFERENCES cards(id) ON DELETE CASCADE,
  version INTEGER NOT NULL, agent_profile_id TEXT NOT NULL REFERENCES agent_profiles(id),
  content_md TEXT NOT NULL, status TEXT NOT NULL, created_at TEXT NOT NULL, approved_at TEXT,
  UNIQUE(card_id, version)
);
CREATE TABLE chats (
  id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  card_id TEXT REFERENCES cards(id) ON DELETE SET NULL, purpose TEXT NOT NULL, provider TEXT NOT NULL,
  profile_id TEXT NOT NULL REFERENCES agent_profiles(id), provider_session_id TEXT,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE TABLE chat_messages (
  id TEXT PRIMARY KEY, chat_id TEXT NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
  role TEXT NOT NULL, body TEXT NOT NULL, status TEXT NOT NULL, created_at TEXT NOT NULL,
  provider_message_id TEXT
);
CREATE TABLE worktrees (
  id TEXT PRIMARY KEY, card_id TEXT NOT NULL REFERENCES cards(id) ON DELETE CASCADE,
  repo_path TEXT NOT NULL, path TEXT NOT NULL, branch TEXT NOT NULL, base_ref TEXT NOT NULL,
  created_at TEXT NOT NULL, cleanup_state TEXT NOT NULL
);
CREATE TABLE runs (
  id TEXT PRIMARY KEY, card_id TEXT NOT NULL REFERENCES cards(id) ON DELETE CASCADE,
  chat_id TEXT NOT NULL REFERENCES chats(id), profile_id TEXT NOT NULL REFERENCES agent_profiles(id),
  status TEXT NOT NULL, started_at TEXT NOT NULL, ended_at TEXT, exit_reason TEXT,
  worktree_id TEXT REFERENCES worktrees(id), provider_turn_id TEXT
);
CREATE TABLE run_events (
  id TEXT PRIMARY KEY, run_id TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
  seq INTEGER NOT NULL, event_type TEXT NOT NULL, payload_json_sanitized TEXT NOT NULL,
  created_at TEXT NOT NULL, UNIQUE(run_id, seq)
);
CREATE TABLE reviews (
  id TEXT PRIMARY KEY, card_id TEXT NOT NULL REFERENCES cards(id) ON DELETE CASCADE,
  provider TEXT NOT NULL, remote_url TEXT, remote_id TEXT, state TEXT NOT NULL,
  target_branch TEXT NOT NULL, source_branch TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE TABLE test_runs (
  id TEXT PRIMARY KEY, card_id TEXT NOT NULL REFERENCES cards(id) ON DELETE CASCADE,
  run_id TEXT REFERENCES runs(id), command TEXT NOT NULL, status TEXT NOT NULL, exit_code INTEGER,
  summary TEXT NOT NULL, started_at TEXT NOT NULL, ended_at TEXT
);
CREATE TABLE column_history (
  id TEXT PRIMARY KEY, card_id TEXT NOT NULL REFERENCES cards(id) ON DELETE CASCADE,
  from_column_id TEXT REFERENCES board_columns(id), to_column_id TEXT NOT NULL REFERENCES board_columns(id),
  changed_at TEXT NOT NULL, actor TEXT NOT NULL, reason TEXT
);
CREATE TABLE approvals (
  id TEXT PRIMARY KEY, run_id TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
  provider_request_id TEXT NOT NULL, description TEXT NOT NULL, decision TEXT,
  requested_at TEXT NOT NULL, decided_at TEXT
);
CREATE TABLE settings (key TEXT PRIMARY KEY, json_value TEXT NOT NULL, updated_at TEXT NOT NULL);
CREATE TABLE notes (
  id TEXT PRIMARY KEY, body TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE INDEX idx_cards_project ON cards(project_id, archived_at, order_key);
CREATE INDEX idx_chats_card ON chats(card_id, updated_at);
CREATE INDEX idx_runs_card ON runs(card_id, started_at);
CREATE INDEX idx_events_run ON run_events(run_id, seq);
`

export const migrations: readonly Migration[] = [
  {
    version: 1,
    checksum: 'sha256:agentboard-schema-v1-2026-10-20',
    up(db) { db.exec(initialSchema) }
  },
  {
    version: 2,
    checksum: 'sha256:agentboard-project-sources-v2-2026-10-20',
    up(db) {
      db.exec(`
        CREATE TABLE project_sources (
          id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
          name TEXT NOT NULL, local_path TEXT NOT NULL, is_git_repository INTEGER NOT NULL DEFAULT 0,
          current_branch TEXT, sort_order INTEGER NOT NULL, UNIQUE(project_id, local_path)
        );
        ALTER TABLE cards ADD COLUMN source_id TEXT REFERENCES project_sources(id);
        INSERT INTO project_sources(id, project_id, name, local_path, is_git_repository, current_branch, sort_order)
          SELECT lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2))) || '-4' || substr(lower(hex(randomblob(2))),2) || '-8' || substr(lower(hex(randomblob(2))),2) || '-' || lower(hex(randomblob(6))),
            id, name, local_path, 1, base_branch, 0 FROM projects;
        UPDATE cards SET source_id = (SELECT ps.id FROM project_sources ps WHERE ps.project_id = cards.project_id ORDER BY ps.sort_order LIMIT 1);
        CREATE INDEX idx_project_sources_project ON project_sources(project_id, sort_order);
      `)
    }
  },
  {
    version: 3,
    checksum: 'sha256:agentboard-remove-automatic-profiles-v3-2026-10-20',
    up(db) {
      db.exec(`
        DELETE FROM agent_profiles
        WHERE id IN (
          '10000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000002',
          '10000000-0000-4000-8000-000000000003', '10000000-0000-4000-8000-000000000004',
          '10000000-0000-4000-8000-000000000005', '10000000-0000-4000-8000-000000000006'
        )
        AND NOT EXISTS (SELECT 1 FROM project_agent_profiles WHERE profile_id = agent_profiles.id)
        AND NOT EXISTS (SELECT 1 FROM plans WHERE agent_profile_id = agent_profiles.id)
        AND NOT EXISTS (SELECT 1 FROM chats WHERE profile_id = agent_profiles.id)
        AND NOT EXISTS (SELECT 1 FROM runs WHERE profile_id = agent_profiles.id);
        UPDATE agent_profiles SET enabled = 0, updated_at = datetime('now')
        WHERE id IN (
          '10000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000002',
          '10000000-0000-4000-8000-000000000003', '10000000-0000-4000-8000-000000000004',
          '10000000-0000-4000-8000-000000000005', '10000000-0000-4000-8000-000000000006'
        );
      `)
    }
  },
  {
    version: 4,
    checksum: 'sha256:agentboard-multi-repo-worktrees-v4-2026-10-20',
    up(db) {
      db.exec(`
        CREATE TABLE worktree_members (
          id TEXT PRIMARY KEY, worktree_id TEXT NOT NULL REFERENCES worktrees(id) ON DELETE CASCADE,
          repo_path TEXT NOT NULL, path TEXT NOT NULL, base_ref TEXT NOT NULL,
          UNIQUE(worktree_id, repo_path)
        );
        CREATE INDEX idx_worktree_members_worktree ON worktree_members(worktree_id);
      `)
    }
  },
  {
    version: 5,
    checksum: 'sha256:agentboard-agent-color-v5-2026-10-21',
    up(db) {
      db.exec(`
        ALTER TABLE agent_profiles ADD COLUMN color TEXT NOT NULL DEFAULT '#aeb9ff';
        UPDATE agent_profiles SET color = CASE provider WHEN 'claude' THEN '#D97757' ELSE '#aeb9ff' END;
      `)
    }
  },
  {
    version: 6,
    checksum: 'sha256:agentboard-backlog-and-no-mr-v6-2026-10-21',
    up(db) {
      // Colunas Backlog/To do/Doing/Test/Done. A linha 'mr' fica no banco (volta segura, o histórico aponta para ela), mas sai do quadro.
      const projects = db.prepare('SELECT id FROM projects').all() as { id: string }[]
      const now = new Date().toISOString()
      for (const { id: projectId } of projects) {
        const column = (state: string): { id: string } | undefined => db.prepare('SELECT id FROM board_columns WHERE project_id = ? AND semantic_state = ?').get(projectId, state) as { id: string } | undefined
        if (!column('backlog')) {
          db.prepare('UPDATE board_columns SET sort_order = sort_order + 1 WHERE project_id = ?').run(projectId)
          db.prepare(`INSERT INTO board_columns(id, project_id, label, sort_order, semantic_state, is_default)
            VALUES (lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2))) || '-4' || substr(lower(hex(randomblob(2))),2) || '-8' || substr(lower(hex(randomblob(2))),2) || '-' || lower(hex(randomblob(6))), ?, 'Backlog', 0, 'backlog', 1)`).run(projectId)
        }
        db.prepare(`UPDATE board_columns SET label = 'To do' WHERE project_id = ? AND semantic_state = 'todo' AND label = 'To Do'`).run(projectId)
        const mr = column('mr'), test = column('test')
        if (mr && test) {
          const cards = db.prepare('SELECT id FROM cards WHERE column_id = ? ORDER BY order_key').all(mr.id) as { id: string }[]
          const next = db.prepare('SELECT COALESCE(MAX(order_key), 0) AS value FROM cards WHERE column_id = ?')
          for (const card of cards) {
            const order = (next.get(test.id) as { value: number }).value + 1024
            db.prepare('UPDATE cards SET column_id = ?, order_key = ?, updated_at = ? WHERE id = ?').run(test.id, order, now, card.id)
            db.prepare(`INSERT INTO column_history(id, card_id, from_column_id, to_column_id, changed_at, actor, reason)
              VALUES (lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2))) || '-4' || substr(lower(hex(randomblob(2))),2) || '-8' || substr(lower(hex(randomblob(2))),2) || '-' || lower(hex(randomblob(6))), ?, ?, ?, ?, 'system', 'migration-mr-to-test')`).run(card.id, mr.id, test.id, now)
          }
        }
      }
    }
  },
  {
    version: 7,
    checksum: 'sha256:agentboard-card-documents-v7-2026-10-21',
    up(db) {
      db.exec(`
        CREATE TABLE card_documents (
          card_id TEXT NOT NULL REFERENCES cards(id) ON DELETE CASCADE,
          kind TEXT NOT NULL CHECK (kind IN ('resumo', 'especificacao', 'plano', 'tasks')),
          content_md TEXT NOT NULL, updated_at TEXT NOT NULL, updated_by TEXT NOT NULL,
          PRIMARY KEY(card_id, kind)
        );
        CREATE TABLE card_document_versions (
          id TEXT PRIMARY KEY, card_id TEXT NOT NULL REFERENCES cards(id) ON DELETE CASCADE,
          kind TEXT NOT NULL, version INTEGER NOT NULL, content_md TEXT NOT NULL, created_at TEXT NOT NULL, actor TEXT NOT NULL,
          UNIQUE(card_id, kind, version)
        );
      `)
      // A descrição antiga vira o Resumo, os critérios viram tasks de primeiro nível e o último plano vira o documento Plano.
      // As colunas e tabelas antigas continuam no banco (volta segura).
      const insertDoc = db.prepare('INSERT INTO card_documents(card_id, kind, content_md, updated_at, updated_by) VALUES (?, ?, ?, ?, \'system\')')
      const insertVersion = db.prepare(`INSERT INTO card_document_versions(id, card_id, kind, version, content_md, created_at, actor)
        VALUES (lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2))) || '-4' || substr(lower(hex(randomblob(2))),2) || '-8' || substr(lower(hex(randomblob(2))),2) || '-' || lower(hex(randomblob(6))), ?, ?, 1, ?, ?, 'system')`)
      const save = (cardId: string, kind: string, content: string, at: string): void => { insertDoc.run(cardId, kind, content, at); insertVersion.run(cardId, kind, content, at) }
      const cards = db.prepare('SELECT id, description, updated_at AS updatedAt FROM cards').all() as { id: string; description: string; updatedAt: string }[]
      for (const card of cards) {
        if (card.description.trim()) save(card.id, 'resumo', card.description, card.updatedAt)
        const criteria = db.prepare('SELECT body, checked FROM card_acceptance_criteria WHERE card_id = ? ORDER BY sort_order').all(card.id) as { body: string; checked: number }[]
        if (criteria.length) save(card.id, 'tasks', criteria.map((item, index) => `- [${item.checked ? 'x' : ' '}] T${String(index + 1).padStart(3, '0')} ${item.body}`).join('\n'), card.updatedAt)
        const plan = db.prepare(`SELECT content_md AS body, created_at AS at FROM plans WHERE card_id = ? ORDER BY CASE status WHEN 'approved' THEN 0 ELSE 1 END, version DESC LIMIT 1`).get(card.id) as { body: string; at: string } | undefined
        if (plan?.body.trim()) save(card.id, 'plano', plan.body, plan.at)
      }
    }
  },
  {
    version: 8,
    checksum: 'sha256:agentboard-card-viewed-v8-2026-10-21',
    up(db) {
      // viewed_at marca quando o usuário viu o resultado da última execução (destaque de "terminado"); o que já existe conta como visto.
      db.exec(`ALTER TABLE cards ADD COLUMN viewed_at TEXT; UPDATE cards SET viewed_at = datetime('now');`)
    }
  },
  {
    version: 9,
    checksum: 'sha256:agentboard-agent-config-v9-2026-10-21',
    up(db) {
      db.exec(`
        CREATE TABLE card_agent_settings (
          card_id TEXT NOT NULL REFERENCES cards(id) ON DELETE CASCADE,
          purpose TEXT NOT NULL CHECK (purpose IN ('planning', 'execution')),
          profile_id TEXT NOT NULL REFERENCES agent_profiles(id), model TEXT, effort TEXT, mode TEXT NOT NULL,
          updated_at TEXT NOT NULL, PRIMARY KEY(card_id, purpose)
        );
        CREATE TABLE agent_usage_stats (
          profile_id TEXT NOT NULL REFERENCES agent_profiles(id) ON DELETE CASCADE,
          purpose TEXT NOT NULL, model TEXT NOT NULL DEFAULT '', effort TEXT NOT NULL DEFAULT '',
          count INTEGER NOT NULL DEFAULT 0, last_used_at TEXT NOT NULL, PRIMARY KEY(profile_id, purpose, model, effort)
        );
      `)
    }
  },
  {
    version: 10,
    checksum: 'sha256:agentboard-chat-skill-v10-2026-10-21',
    up(db) { db.exec('ALTER TABLE chats ADD COLUMN skill_name TEXT; ALTER TABLE chats ADD COLUMN skill_path TEXT;') }
  },
  {
    version: 11,
    checksum: 'sha256:agentboard-usage-snapshots-v11-2026-10-21',
    up(db) {
      db.exec(`CREATE TABLE agent_usage_snapshots (
        profile_id TEXT NOT NULL REFERENCES agent_profiles(id) ON DELETE CASCADE, window TEXT NOT NULL,
        utilization REAL NOT NULL, resets_at TEXT, captured_at TEXT NOT NULL, PRIMARY KEY(profile_id, window)
      )`)
    }
  },
  {
    version: 12,
    checksum: 'sha256:agentboard-test-purpose-v12-2026-10-21',
    up(db) {
      // A finalidade "test" (agente de teste) entra na tabela; o CHECK antigo só aceitava planning/execution, então a tabela é recriada.
      db.exec(`
        CREATE TABLE card_agent_settings_new (
          card_id TEXT NOT NULL REFERENCES cards(id) ON DELETE CASCADE,
          purpose TEXT NOT NULL CHECK (purpose IN ('planning', 'execution', 'test')),
          profile_id TEXT NOT NULL REFERENCES agent_profiles(id), model TEXT, effort TEXT, mode TEXT NOT NULL,
          updated_at TEXT NOT NULL, PRIMARY KEY(card_id, purpose)
        );
        INSERT INTO card_agent_settings_new SELECT card_id, purpose, profile_id, model, effort, mode, updated_at FROM card_agent_settings;
        DROP TABLE card_agent_settings;
        ALTER TABLE card_agent_settings_new RENAME TO card_agent_settings;
      `)
    }
  },
  {
    version: 13,
    checksum: 'sha256:agentboard-collaboration-v13-2026-10-21',
    up(db) {
      // Comunicação entre as etapas: dúvidas (dev/teste → planejador → usuário) e propostas de mudança (esperam autorização).
      // Os documentos Dúvidas e Mudanças são gerados a partir destas tabelas; card_documents é recriada para aceitar os dois tipos novos.
      db.exec(`
        CREATE TABLE card_documents_new (
          card_id TEXT NOT NULL REFERENCES cards(id) ON DELETE CASCADE,
          kind TEXT NOT NULL CHECK (kind IN ('resumo', 'especificacao', 'plano', 'tasks', 'duvidas', 'mudancas')),
          content_md TEXT NOT NULL, updated_at TEXT NOT NULL, updated_by TEXT NOT NULL,
          PRIMARY KEY(card_id, kind)
        );
        INSERT INTO card_documents_new SELECT card_id, kind, content_md, updated_at, updated_by FROM card_documents;
        DROP TABLE card_documents;
        ALTER TABLE card_documents_new RENAME TO card_documents;
        CREATE TABLE card_questions (
          id TEXT PRIMARY KEY, card_id TEXT NOT NULL REFERENCES cards(id) ON DELETE CASCADE, number INTEGER NOT NULL,
          asker_purpose TEXT NOT NULL, asker_chat_id TEXT, question TEXT NOT NULL,
          status TEXT NOT NULL CHECK (status IN ('open', 'planner', 'user', 'answered')),
          answer TEXT, answered_by TEXT, user_question TEXT, rounds INTEGER NOT NULL DEFAULT 0, delivered INTEGER NOT NULL DEFAULT 0,
          created_at TEXT NOT NULL, answered_at TEXT, UNIQUE(card_id, number)
        );
        CREATE TABLE card_changes (
          id TEXT PRIMARY KEY, card_id TEXT NOT NULL REFERENCES cards(id) ON DELETE CASCADE, number INTEGER NOT NULL,
          proposer_purpose TEXT NOT NULL, proposer_chat_id TEXT, title TEXT NOT NULL, details TEXT NOT NULL, reason TEXT NOT NULL,
          status TEXT NOT NULL CHECK (status IN ('pending', 'accepted', 'suggested', 'rejected', 'applied')),
          user_note TEXT, created_at TEXT NOT NULL, decided_at TEXT, UNIQUE(card_id, number)
        );
      `)
    }
  },
  {
    version: 14,
    checksum: 'sha256:agentboard-plan-ready-v14-2026-10-21',
    up(db) {
      // O planejador declara o plano concluído (ferramenta/marcador); antes disso o card só "está em planejamento". Cards antigos com Plano escrito seguem prontos.
      db.exec(`ALTER TABLE cards ADD COLUMN plan_ready_at TEXT;
        UPDATE cards SET plan_ready_at = datetime('now') WHERE EXISTS (SELECT 1 FROM card_documents d WHERE d.card_id = cards.id AND d.kind = 'plano' AND length(trim(d.content_md)) > 0);`)
    }
  },
  {
    version: 15,
    checksum: 'sha256:agentboard-free-chat-v15-2026-10-21',
    disableForeignKeys: true,
    up(db) {
      // Chat livre: conversa sem card. runs.card_id passa a aceitar NULL (recriação da tabela, mantendo run_events/test_runs/approvals) e o chat ganha um título.
      db.exec(`
        CREATE TABLE runs_new (
          id TEXT PRIMARY KEY, card_id TEXT REFERENCES cards(id) ON DELETE CASCADE,
          chat_id TEXT NOT NULL REFERENCES chats(id), profile_id TEXT NOT NULL REFERENCES agent_profiles(id),
          status TEXT NOT NULL, started_at TEXT NOT NULL, ended_at TEXT, exit_reason TEXT,
          worktree_id TEXT REFERENCES worktrees(id), provider_turn_id TEXT
        );
        INSERT INTO runs_new SELECT id, card_id, chat_id, profile_id, status, started_at, ended_at, exit_reason, worktree_id, provider_turn_id FROM runs;
        DROP TABLE runs;
        ALTER TABLE runs_new RENAME TO runs;
        CREATE INDEX idx_runs_card ON runs(card_id, started_at);
        ALTER TABLE chats ADD COLUMN title TEXT;
      `)
    }
  },
  {
    version: 16,
    checksum: 'sha256:agentboard-profile-removed-v16-2026-10-21',
    up(db) {
      // Remover um agente com histórico só o desativa: some das listas e não executa mais, mas os cards e chats seguem mostrando quem executou.
      db.exec('ALTER TABLE agent_profiles ADD COLUMN removed_at TEXT;')
    }
  },
  {
    version: 17,
    checksum: 'sha256:agentboard-card-base-branch-v17-2026-10-22',
    up(db) {
      // Branch base escolhida ao iniciar a execução: a worktree do card nasce a partir dela (vazio = a branch atual de cada repositório).
      db.exec('ALTER TABLE cards ADD COLUMN base_branch TEXT;')
    }
  },
  {
    version: 18,
    checksum: 'sha256:agentboard-run-tokens-v18-2026-10-22',
    up(db) {
      // Tokens gastos por execução (somados por etapa do card): lidos de novo, vindos do cache e escritos pelo agente.
      db.exec(`ALTER TABLE runs ADD COLUMN input_tokens INTEGER NOT NULL DEFAULT 0;
        ALTER TABLE runs ADD COLUMN cached_tokens INTEGER NOT NULL DEFAULT 0;
        ALTER TABLE runs ADD COLUMN output_tokens INTEGER NOT NULL DEFAULT 0;`)
    }
  },
  {
    version: 19,
    checksum: 'sha256:agentboard-constitution-v19-2026-10-21',
    up(db) {
      // Constituição do projeto (opcional): texto atual, versões e as mudanças que os agentes sugerem fora do chat dela.
      db.exec(`CREATE TABLE project_constitutions (
          project_id TEXT PRIMARY KEY REFERENCES projects(id) ON DELETE CASCADE, content_md TEXT NOT NULL, version INTEGER NOT NULL,
          updated_at TEXT NOT NULL, updated_by TEXT NOT NULL CHECK (updated_by IN ('user', 'agent', 'system')));
        CREATE TABLE project_constitution_versions (
          id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE, version INTEGER NOT NULL, content_md TEXT NOT NULL,
          created_at TEXT NOT NULL, actor TEXT NOT NULL CHECK (actor IN ('user', 'agent', 'system')), UNIQUE(project_id, version));
        CREATE TABLE constitution_proposals (
          id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE, number INTEGER NOT NULL,
          card_id TEXT REFERENCES cards(id) ON DELETE SET NULL, chat_id TEXT, title TEXT NOT NULL, details TEXT NOT NULL, reason TEXT NOT NULL,
          status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'applied', 'dismissed')), created_at TEXT NOT NULL, UNIQUE(project_id, number));`)
    }
  },
  {
    version: 20,
    checksum: 'sha256:agentboard-project-icon-v20-2026-10-21',
    up(db) {
      // Ícone do projeto (imagem em data URL) no lugar da inicial na barra lateral.
      db.exec('ALTER TABLE projects ADD COLUMN icon TEXT;')
    }
  },
  {
    version: 21,
    checksum: 'sha256:agentboard-test-checklist-v21-2026-10-21',
    up(db) {
      // Checklist do testador: o que ele vai verificar, marcado conforme verifica (aparece ao lado do chat do teste).
      db.exec(`CREATE TABLE card_checklists (
          card_id TEXT NOT NULL REFERENCES cards(id) ON DELETE CASCADE, purpose TEXT NOT NULL CHECK (purpose IN ('test')),
          content_md TEXT NOT NULL, updated_at TEXT NOT NULL, PRIMARY KEY(card_id, purpose));`)
    }
  },
  {
    version: 22,
    checksum: 'sha256:agentboard-project-order-v22-2026-10-21',
    up(db) {
      // Ordem dos projetos na barra lateral (o usuário arrasta). Começa na ordem de antes: o mais recente em cima.
      db.exec(`ALTER TABLE projects ADD COLUMN sort_order INTEGER;
        UPDATE projects SET sort_order = (SELECT COUNT(*) FROM projects p WHERE p.updated_at > projects.updated_at OR (p.updated_at = projects.updated_at AND p.id < projects.id));`)
    }
  },
  {
    version: 23,
    checksum: 'sha256:agentboard-auto-resume-v23-2026-10-21',
    up(db) {
      // Retomadas agendadas para quando o limite de uso do agente voltar.
      db.exec(`CREATE TABLE auto_resumes (
          id TEXT PRIMARY KEY, chat_id TEXT NOT NULL REFERENCES chats(id) ON DELETE CASCADE, card_id TEXT REFERENCES cards(id) ON DELETE CASCADE,
          purpose TEXT NOT NULL, profile_id TEXT NOT NULL, resume_at TEXT NOT NULL,
          status TEXT NOT NULL CHECK (status IN ('pending', 'done', 'cancelled', 'replaced')), created_at TEXT NOT NULL);
        CREATE INDEX idx_auto_resumes_pending ON auto_resumes(status, resume_at);`)
    }
  },
  {
    version: 24,
    checksum: 'sha256:agentboard-git-manager-v24-2026-10-22',
    up(db) {
      // Gerenciador Git: regra de commit do agente por projeto (JSON), pedidos de commit esperando o usuário e quem (agente) fez cada commit.
      db.exec(`ALTER TABLE projects ADD COLUMN git_policy TEXT;
        CREATE TABLE git_commit_requests (
          id TEXT PRIMARY KEY, card_id TEXT NOT NULL REFERENCES cards(id) ON DELETE CASCADE, source_id TEXT NOT NULL, repo_name TEXT NOT NULL, repo_path TEXT NOT NULL,
          chat_id TEXT, profile_id TEXT, message TEXT NOT NULL, files TEXT NOT NULL, status TEXT NOT NULL CHECK (status IN ('pending', 'done', 'denied', 'failed')),
          hash TEXT, error TEXT, created_at TEXT NOT NULL, decided_at TEXT);
        CREATE INDEX idx_git_commit_requests_card ON git_commit_requests(card_id, status);
        CREATE TABLE git_commit_agents (repo_path TEXT NOT NULL, hash TEXT NOT NULL, profile_id TEXT NOT NULL, PRIMARY KEY(repo_path, hash));`)
    }
  },
  {
    version: 25,
    checksum: 'sha256:agentboard-change-sent-v25-2026-10-22',
    up(db) {
      // Mudança autorizada só deixa de lembrar o usuário quando foi mandada ao desenvolvedor (automático ao fim do planejador, ou pelo botão). As já aplicadas contam como enviadas.
      db.exec(`ALTER TABLE card_changes ADD COLUMN sent_at TEXT;
        UPDATE card_changes SET sent_at = COALESCE(decided_at, created_at) WHERE status = 'applied';`)
    }
  },
  {
    version: 26,
    checksum: 'sha256:agentboard-assessments-v26-2026-10-23',
    up(db) {
      // Complexity Engine e rastreabilidade (docs/09): avaliações versionadas (nunca sobrescritas), decisões, eventos espelhados em
      // history.jsonl, fluxo escolhido do card, configuração de workflow do projeto e métricas por execução (só o que o agente informa).
      db.exec(`CREATE TABLE card_assessments (
          id TEXT PRIMARY KEY, card_id TEXT NOT NULL REFERENCES cards(id) ON DELETE CASCADE, version INTEGER NOT NULL, preliminary INTEGER NOT NULL,
          scores_json TEXT NOT NULL, weights_json TEXT NOT NULL, total INTEGER NOT NULL, level TEXT NOT NULL CHECK (level IN ('simple', 'medium', 'complex')),
          confidence TEXT NOT NULL CHECK (confidence IN ('low', 'medium', 'high')), critical_risks_json TEXT NOT NULL, justifications_json TEXT NOT NULL, evidence_json TEXT NOT NULL,
          workflow TEXT NOT NULL, trigger TEXT NOT NULL, reason TEXT NOT NULL, actor TEXT NOT NULL CHECK (actor IN ('agent', 'user')),
          profile_id TEXT, provider TEXT, model TEXT, effort TEXT, code_version TEXT, supersedes_id TEXT, created_at TEXT NOT NULL, UNIQUE(card_id, version));
        CREATE TABLE card_decisions (
          id TEXT PRIMARY KEY, card_id TEXT NOT NULL REFERENCES cards(id) ON DELETE CASCADE, number INTEGER NOT NULL, kind TEXT NOT NULL, statement TEXT NOT NULL,
          rationale TEXT NOT NULL, status TEXT NOT NULL CHECK (status IN ('proposed', 'approved', 'superseded')), actor TEXT NOT NULL CHECK (actor IN ('agent', 'user')),
          supersedes_id TEXT, created_at TEXT NOT NULL, UNIQUE(card_id, number));
        CREATE TABLE card_events (
          id TEXT PRIMARY KEY, card_id TEXT NOT NULL REFERENCES cards(id) ON DELETE CASCADE, project_id TEXT NOT NULL, type TEXT NOT NULL, schema_version INTEGER NOT NULL,
          actor TEXT NOT NULL, created_at TEXT NOT NULL, json TEXT NOT NULL, synced_at TEXT);
        CREATE INDEX idx_card_assessments_card ON card_assessments(card_id, version);
        CREATE INDEX idx_card_events_card ON card_events(card_id, created_at);
        CREATE INDEX idx_card_events_unsynced ON card_events(synced_at) WHERE synced_at IS NULL;
        ALTER TABLE cards ADD COLUMN workflow TEXT;
        ALTER TABLE projects ADD COLUMN workflow_config TEXT;
        ALTER TABLE runs ADD COLUMN purpose TEXT;
        ALTER TABLE runs ADD COLUMN provider TEXT;
        ALTER TABLE runs ADD COLUMN model TEXT;
        ALTER TABLE runs ADD COLUMN effort TEXT;
        ALTER TABLE runs ADD COLUMN cost_usd REAL;
        ALTER TABLE runs ADD COLUMN prompt_chars INTEGER;`)
    }
  },
  {
    version: 27,
    checksum: 'sha256:agentboard-coordinated-worktrees-v27-2026-10-23',
    up(db) {
      // Worktrees coordenados: repositórios envolvidos no card (vazio = todos, como antes), estado de cada repositório da worktree
      // (falha parcial não derruba os outros) e o PR de cada um. Uso do Playwright CLI por execução, para comparar custo.
      db.exec(`ALTER TABLE cards ADD COLUMN repo_ids TEXT;
        ALTER TABLE worktree_members ADD COLUMN status TEXT NOT NULL DEFAULT 'active';
        ALTER TABLE worktree_members ADD COLUMN error TEXT;
        ALTER TABLE worktree_members ADD COLUMN pr_url TEXT;
        ALTER TABLE runs ADD COLUMN used_playwright_cli INTEGER NOT NULL DEFAULT 0;`)
    }
  },
  {
    version: 28,
    checksum: 'sha256:agentboard-checklist-marks-v28-2026-10-26',
    up(db) {
      // Quem marcou cada item do checklist de teste (usuário ou agente) e quando: JSON { "<texto do item>": { by, at } }.
      db.exec(`ALTER TABLE card_checklists ADD COLUMN marks TEXT;`)
    }
  },
  {
    version: 29,
    checksum: 'sha256:agentboard-shared-worktree-v29-2026-10-27',
    up(db) {
      // Card que usa a worktree de outro card (em vez de criar a sua): guarda quem é o dono. Vazio = o card tem a própria.
      db.exec(`ALTER TABLE cards ADD COLUMN worktree_card_id TEXT;`)
    }
  }
]

export const latestSchemaVersion = migrations.at(-1)?.version ?? 0
