//! Run · Task 수명 전이 — 사람 명령 · 조정자 CLI 종료 · 서버 시계. 잠금은 `store.rs` 의 하나를 쓰고, 사건은 늘 그 잠금 안에서 `after_change` 로 낸다.

use serde_json::{json, Value};

use super::*;

impl Orchestration {
    // ── 사람 명령 ──

    /// 시험 전용 — 통합 ref 없는 Run.
    #[cfg(test)]
    pub(crate) fn start_run(&self, s: StartRun) -> Result<(String, u32), OrchError> {
        let id = new_id("run").ok_or_else(no_randomness)?;
        self.start_run_with(s, id, None)
    }

    #[cfg(test)]
    pub(in crate::orchestration) fn start_run_with(&self, s: StartRun, id: String, integration: Option<Integration>) -> Result<(String, u32), OrchError> {
        self.start_run_core(s, id, integration)
    }

    #[cfg(test)]
    pub(in crate::orchestration) fn start_run_core(
        &self,
        s: StartRun,
        id: String,
        integration: Option<Integration>,
    ) -> Result<(String, u32), OrchError> {
        self.start_run_core_with_album(s, id, integration, None)
    }

    /// 사람 앨범은 신원 · 구성 · 조정자 · 귀속을 이 한 잠금에서 함께 세운다 — 그 사이 다른 요청이 끼지 않게.
    pub(in crate::orchestration) fn start_run_core_with_album(
        &self,
        s: StartRun,
        id: String,
        integration: Option<Integration>,
        human: Option<(&super::album_start::PreparedAlbum, &Seat)>,
    ) -> Result<(String, u32), OrchError> {
        let now = self.now();
        let snapshot = human.map(|(p, _)| p.identity.clone());
        let limits = s.limits;
        #[cfg(test)]
        let test_album = if human.is_none() { self.test_config.lock().unwrap().clone() } else { None };
        #[cfg(test)]
        let snapshot = if test_album.is_some() {
            let source = self.album_source.read().unwrap().clone();
            source(&s.repo).identity.ok().map(|id| RunDelegation {path:s.repo.clone(),git_dir:id.git_dir,repo_id:id.repo_id,accepted_sha:String::new(),at:now})
        } else {snapshot};
        let audit_detail = {
            let mut g = self.lock();
            if g.runs.values().filter(|s| s.run.state.active()).count() >= MAX_ACTIVE_RUNS {
                return Err(OrchError::new(
                    reason::TOO_MANY_RUNS,
                    format!("at most {MAX_ACTIVE_RUNS} runs can be active at once — stop one first"),
                ));
            }
            if let Some((_, seat)) = human {
                if !crate::chat_token::still_current(&seat.chat, seat.proc)
                    || crate::chat_token::album_of(&seat.chat, seat.proc).as_deref() != Some(&id) {
                    return Err(OrchError::new(reason::NOT_A_TILE, "프로듀서 세대가 끝났습니다"));
                }
                if let Some(other) = g.producer_ever.get(&seat.chat) {
                    return Err(OrchError::new("already-produced", json!({"runId": other}).to_string()));
                }
            }
            let coordination = u64::from(limits.coordination_minutes) * MINUTE_MS;
            let execution = coordination + u64::from(limits.execution_grace_minutes) * MINUTE_MS;
            let mut run = Run {
                album: human.map(|(p, _)| p.album.clone()),
                id: id.clone(),
                name: s.name,
                state: RunState::Running,
                previous_state: None,
                gen: 1,
                created_at: now,
                updated_at: now,
                ended_at: None,
                limits,
                // 옛 파일 호환 칸 — 새 Run 은 쓰지 않는다(읽은 옛 값은 다시 저장할 때 그대로).
                worker_permission: None,
                attach_mode: None,
                auto_stop_reported: None,
                allowed_clis: None,
                repo: s.repo,
                worktree_dir: s.worktree_dir,
                coordination_deadline_at: now + coordination,
                execution_deadline_at: now + execution,
                pause_reason: None,
                seq: 0,
                tasks: Vec::new(),
                attempts: Vec::new(),
                reports: Vec::new(),
                accepted: Vec::new(),
                reviews: Vec::new(),
                // 옛 파일 호환 칸 — 새 Run 은 쓰지 않는다.
                deliveries: None,
                commits: Vec::new(),
                log: Vec::new(),
                requests: VecDeque::new(),
                integration,
                hold: None,
                jobs: Vec::new(),
                // 검증 명령은 사람만 정한다 — Run 을 세울 때 한 번 고정되고 도중에 바꾸는 길이 없다.
                verify: s.verify,
                // 옛 파일 호환 칸 — 새 Run 은 쓰지 않는다.
                require_review: None,
                reviewer_clis: None,
                review_reports: Vec::new(),
                temp_pending: Vec::new(),
                delegation: snapshot,
                origin: human.map_or_else(human_origin, |(p, seat)| RunOrigin {
                    by: "human".into(), producer: Some(seat.chat.clone()), producer_config: Some(p.producer.clone()),
                }),
                // 귀속은 아래 색인과 같은 잠금에서 선다.
                producers: human.map(|(_, seat)| vec![seat.chat.clone()]).unwrap_or_default(),
                wakes: Vec::new(),
                wake_handled_to: 0,
                archived_at: None,
                merge: None,
            };
            #[cfg(test)]
            if run.album.is_none() { run.album = test_album; if let (Some(a),Some(v))=(&mut run.album,&run.verify) { a.verify_auto=v.auto_run; } }
            let actor = Actor::Human;
            run.bump(now, actor, "run_started", None, RunState::Running.as_str());
            let detail = OrchestrationAudit {
                gen: 1,
                actor: actor.as_str().into(),
                origin: Some(run.origin.by.clone()),
                run_state: Some(RunState::Running.as_str().into()),
                worker_permission: run.worker_permission.map(|p| p.as_str().into()),
                limits: Some(audit_limits(&run.limits)),
                // 검증 명령의 글자는 감사에 싣지 않는다.
                command_len: run.verify.as_ref().map(|v| v.command.chars().count() as u32),
                command_sha: run.verify.as_ref().map(|v| v.command_sha.clone()),
                auto_run: run.verify.as_ref().map(|v| v.auto_run),
                delegation_sha: run.delegation.as_ref().map(|d| d.accepted_sha.clone()),
                album_sha: run.album.as_ref().map(|a| crate::chat_token::input_sha(&json!(a))),
                ..Default::default()
            };
            let mut slot = Slot::new(run);
            if let Some((p, seat)) = human {
                slot.coordinator = Some((1, seat.clone()));
                slot.inputs_seen = Some(super::album::RunInputs::Album(p.inputs.clone()));
                g.producer_ever.insert(seat.chat.clone(), id.clone());
            }
            g.runs.insert(id.clone(), slot);
            self.after_change(&g, &id);
            detail
        };
        self.audit("run_started", &id, audit_detail);
        Ok((id, 1))
    }

    pub(crate) fn pause(&self, run_id: &str) -> Result<(), OrchError> {
        let now = self.now();
        let gen = {
            let mut g = self.lock();
            let slot = human_slot(&mut g, run_id)?;
            match slot.run.state {
                RunState::Paused => return Ok(()),
                RunState::Running => {}
                s => return Err(state_error(s)),
            }
            slot.run.state = RunState::Paused;
            slot.run.pause_reason = Some("human".into());
            slot.run.bump(now, Actor::Human, "human_paused", None, RunState::Paused.as_str());
            let gen = slot.run.gen;
            self.after_change(&g, run_id);
            gen
        };
        // 도는 턴은 끝까지 둔다 — 일시정지는 새 조율 쓰기 · 새 턴만 막는다.
        self.audit("human_paused", run_id, human_detail(gen, RunState::Paused));
        Ok(())
    }

    /// 지금 세대의 조정자가 묶여 있어야 한다 — 조정자 없는 running 은 아무도 조율하지 못하고 `adopt_run` 도 받지 않는다.
    pub(crate) fn resume(&self, run_id: &str) -> Result<(), OrchError> {
        let now = self.now();
        let gen = {
            let mut g = self.lock();
            let slot = human_slot(&mut g, run_id)?;
            match slot.run.state {
                RunState::Running => return Ok(()),
                RunState::Paused => {}
                s => return Err(state_error(s)),
            }
            if let Some(h) = &slot.run.hold {
                return Err(on_hold(h));
            }
            if now >= slot.run.coordination_deadline_at {
                return Err(OrchError::new(
                    reason::LIMIT_REACHED,
                    "the coordination time limit of this run has passed — stop it or start a new run",
                ));
            }
            if !has_coordinator(slot) {
                return Err(OrchError::new(
                    reason::NO_COORDINATOR,
                    "this run has no coordinator — have an AI tile take it over with adopt_run, or stop it",
                ));
            }
            slot.run.state = RunState::Running;
            slot.run.pause_reason = None;
            slot.run.bump(now, Actor::Human, "human_resumed", None, RunState::Running.as_str());
            let gen = slot.run.gen;
            self.after_change(&g, run_id);
            gen
        };
        self.audit("human_resumed", run_id, human_detail(gen, RunState::Running));
        Ok(())
    }

    /// 조정자 묶음은 즉시 푼다. `stopped` 는 작업자 트리의 종료가 확인된 뒤에만 — 작업자 토큰도 그때 거둔다(늦은 보고를 `late` 로 받으려고).
    pub(crate) fn stop(&self, run_id: &str) -> Result<(), OrchError> {
        let now = self.now();
        let (gen, ended, to_stop) = {
            let mut g = self.lock();
            let slot = human_slot(&mut g, run_id)?;
            match slot.run.state {
                RunState::Stopping | RunState::Stopped | RunState::Done => return Ok(()),
                RunState::Running | RunState::Paused => {}
                s => return Err(state_error(s)),
            }
            slot.run.state = RunState::Stopping;
            slot.run.bump(now, Actor::Human, "human_stopped", None, RunState::Stopping.as_str());
            let to_stop = super::attempts::mark_all_stopping(slot, now, Actor::Human);
            // 커밋 단계 전의 통합 작업만 거둔다 — 커밋 중인 것은 끝을 기다린다.
            super::integrate::abort_cancellable(slot, now, Actor::Human, "stopped");
            let gen = slot.run.gen;
            let ended = settle_stopping(slot, now);
            if ended {
                self.raise(slot, "run-ended", None, Some(RunState::Stopped.as_str()));
            }
            revoke_coordinator(&mut g, run_id);
            if ended {
                revoke_run(&mut g, run_id);
            }
            self.after_change(&g, run_id);
            (gen, ended, to_stop)
        };
        self.stop_processes(run_id, &to_stop);
        self.audit("human_stopped", run_id, human_detail(gen, RunState::Stopping));
        if ended {
            self.audit("run_ended", run_id, human_detail(gen, RunState::Stopped));
        }
        Ok(())
    }

    /// 시험 전용 — 제품의 세대 교체는 `adopt_run` 뿐이다.
    #[cfg(test)]
    pub(crate) fn bump_gen_for_test(&self, run_id: &str) -> Result<u32, OrchError> {
        let now = self.now();
        let mut g = self.lock();
        let slot = human_slot(&mut g, run_id)?;
        match slot.run.state {
            RunState::Running | RunState::Paused => {}
            s => return Err(state_error(s)),
        }
        slot.run.gen += 1;
        let gen = slot.run.gen;
        slot.run.bump(now, Actor::Server, "generation_bumped", None, &format!("gen {gen}"));
        // 옛 세대가 요청한 통합 작업은 커밋 단계 전이면 거둔다 — `adopt_run` 과 같은 규칙.
        super::integrate::abort_cancellable(slot, now, Actor::Server, "generation");
        unbind_coordinator(slot);
        self.after_change(&g, run_id);
        Ok(gen)
    }

    /// 수락 · 반려 · 뒤집기는 여기가 아니라 `human_review` 다 — 불변 산출물 · 검토 기록을 함께 만든다.
    pub(crate) fn set_task_state(&self, run_id: &str, task_id: &str, version: u64, state: TaskState) -> Result<Value, OrchError> {
        let now = self.now();
        let (result, gen, title_len) = {
            let mut g = self.lock();
            let slot = human_slot(&mut g, run_id)?;
            match slot.run.state {
                RunState::Running | RunState::Paused | RunState::Stopping => {}
                s => return Err(state_error(s)),
            }
            let Some(task) = slot.run.tasks.iter_mut().find(|t| t.id == task_id) else {
                return Err(OrchError::new(reason::NOT_FOUND, format!("no task {task_id} in this run")));
            };
            if task.version != version {
                return Err(conflict(task));
            }
            if task.state == TaskState::Integrating {
                return Err(OrchError::new(
                    reason::TASK_BUSY,
                    format!("task {task_id} is being integrated — cancel the integration first"),
                ));
            }
            let ok = match state {
                TaskState::Cancelled => !matches!(task.state, TaskState::Accepted | TaskState::Cancelled),
                TaskState::Todo => matches!(task.state, TaskState::Cancelled | TaskState::Rejected),
                _ => false,
            };
            if !ok {
                return Err(OrchError::new(
                    reason::INVALID_STATE,
                    format!("a person cannot move a {} task to {} here", task.state.as_str(), state.as_str()),
                ));
            }
            task.state = state;
            if state == TaskState::Cancelled {
                task.conflict = None;
            }
            task.version += 1;
            task.updated_at = now;
            let task = task.clone();
            if state == TaskState::Cancelled {
                super::review::invalidate(slot, task_id, now, Actor::Human, "cancelled");
                super::attempts::close_task_workers(slot, task_id, now, Actor::Human);
            }
            let seq = slot.run.bump(now, Actor::Human, "task_updated", Some(task_id), state.as_str());
            let gen = slot.run.gen;
            self.after_change(&g, run_id);
            (json!({ "task": task, "latestSeq": seq }), gen, task.title.chars().count())
        };
        self.audit(
            "task_updated",
            run_id,
            OrchestrationAudit {
                gen,
                actor: Actor::Human.as_str().into(),
                task_id: Some(task_id.into()),
                task_version: result["task"]["version"].as_u64(),
                task_state: Some(state.as_str().into()),
                title_len: Some(title_len as u32),
                ..Default::default()
            },
        );
        self.drain_stops(run_id);
        Ok(result)
    }

    #[cfg(test)]
    pub(crate) fn coordinator_exited(&self, chat: &str) -> usize {
        self.coordinator_exited_seat(&Seat::test(chat))
    }

    /// 프로듀서 프로세스가 끝나 토큰을 거둔 뒤 · 채팅 잠금 밖에서 부른다. 정확히 같은 `(chat, proc)` 의 묶음만 푼다 — 옛 세대의 늦은 정리는 새 묶음에 닿지 않는다.
    /// running 이면 paused 로 — 조정자 없이 조율 쓰기가 열려 있지 않게. 이미 paused 면 상태 · 까닭은 그대로 둔다.
    pub(crate) fn coordinator_exited_seat(&self, seat: &Seat) -> usize {
        let now = self.now();
        let mut audits: Vec<(String, OrchestrationAudit)> = Vec::new();
        {
            let mut g = self.lock();
            let ids: Vec<String> = g
                .runs
                .iter()
                .filter(|(_, s)| s.coordinator.as_ref().is_some_and(|(_, st)| st == seat))
                .map(|(id, _)| id.clone())
                .collect();
            if !ids.is_empty() {
                self.changed.notify_all();
            }
            for id in ids {
                let Some(slot) = g.runs.get_mut(&id) else { continue };
                let bound_gen = unbind_coordinator(slot);
                if bound_gen != Some(slot.run.gen) || !matches!(slot.run.state, RunState::Running | RunState::Paused) {
                    continue;
                }
                let already = slot.run.state == RunState::Paused;
                if !already {
                    slot.run.state = RunState::Paused;
                    slot.run.pause_reason = Some("coordinator-exited".into());
                }
                slot.run.bump(now, Actor::Server, "coordinator_exited", None, RunState::Paused.as_str());
                self.raise(slot, "coordinator-exited", None, already.then_some("already-paused"));
                let gen = slot.run.gen;
                self.after_change(&g, &id);
                audits.push((id, server_detail(gen, RunState::Paused)));
            }
        }
        let n = audits.len();
        for (id, detail) in audits {
            self.audit("coordinator_exited", &id, detail);
        }
        n
    }

    pub(crate) fn tick(&self) -> usize {
        let now = self.now();
        let mut audits: Vec<(String, &'static str, OrchestrationAudit)> = Vec::new();
        let mut changed: Vec<String> = Vec::new();
        let mut to_stop: Vec<(String, String)> = Vec::new();
        {
            let mut g = self.lock();
            let ids: Vec<String> = g.runs.keys().cloned().collect();
            for id in ids {
                let Some(slot) = g.runs.get_mut(&id) else { continue };
                let gen = slot.run.gen;
                let expired = super::verify::approval_timeouts(slot, now);
                for a in &expired {
                    self.raise(slot, "verify-failed", Some(a), Some(reason::APPROVAL_EXPIRED));
                }
                if !expired.is_empty() {
                    changed.push(id.clone());
                }
                if super::verify::reconfirm_leftovers(slot) {
                    changed.push(id.clone());
                    if settle_stopping(slot, now) {
                        self.raise(slot, "run-ended", None, Some(RunState::Stopped.as_str()));
                        revoke_run(&mut g, &id);
                        audits.push((id.clone(), "run_ended", server_detail(gen, RunState::Stopped)));
                        continue;
                    }
                }
                if matches!(slot.run.state, RunState::Running | RunState::Paused) && now >= slot.run.execution_deadline_at {
                    slot.run.state = RunState::Stopping;
                    slot.run.bump(now, Actor::Server, "limit_reached", None, "execution-time");
                    self.raise(slot, "limit", None, Some("execution-time"));
                    let list = super::attempts::mark_all_stopping(slot, now, Actor::Server);
                    super::integrate::abort_cancellable(slot, now, Actor::Server, "stopped");
                    to_stop.extend(list.into_iter().map(|a| (id.clone(), a)));
                    let ended = settle_stopping(slot, now);
                    if ended {
                        self.raise(slot, "run-ended", None, Some(RunState::Stopped.as_str()));
                    }
                    revoke_coordinator(&mut g, &id);
                    if ended {
                        revoke_run(&mut g, &id);
                    }
                    audits.push((id.clone(), "limit_reached", limit_detail(gen, "execution-time", RunState::Stopping)));
                    if ended {
                        audits.push((id.clone(), "run_ended", server_detail(gen, RunState::Stopped)));
                    }
                    changed.push(id);
                } else if slot.run.state == RunState::Running && now >= slot.run.coordination_deadline_at {
                    slot.run.state = RunState::Paused;
                    slot.run.pause_reason = Some("coordination-limit".into());
                    slot.run.bump(now, Actor::Server, "limit_reached", None, "coordination-time");
                    self.raise(slot, "limit", None, Some("coordination-time"));
                    audits.push((id.clone(), "limit_reached", limit_detail(gen, "coordination-time", RunState::Paused)));
                    changed.push(id);
                }
            }
            changed.dedup();
            for id in &changed {
                self.after_change(&g, id);
            }
        }
        for (id, event, detail) in audits {
            self.audit(event, &id, detail);
        }
        for (run, att) in &to_stop {
            self.stop_processes(run, std::slice::from_ref(att));
        }
        // 부른 쪽이 놓친 멈춤도 여기서 맡긴다.
        let queued: Vec<String> = self.lock().runs.keys().cloned().collect();
        for id in queued {
            self.drain_stops(&id);
        }
        self.cleanup_tick();
        self.recheck_unknown_commits();
        changed.len()
    }

    /// 잠금 밖에서 부른다.
    pub(in crate::orchestration) fn drain_stops(&self, run_id: &str) {
        let ids: Vec<String> = match self.lock().runs.get_mut(run_id) {
            Some(slot) => std::mem::take(&mut slot.stop_queue),
            None => return,
        };
        self.stop_processes(run_id, &ids);
    }
}
