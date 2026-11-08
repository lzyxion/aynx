//! Run · Task **수명 전이** — 사람 명령(시작 · 일시정지 · 재개 · 중단 · Task 상태 — 보관은 `archive.rs`) · 조정자 CLI 종료 · 서버 시계(`tick` — 시한) ·
//! 멈출 몫 비우기. 잠금 · `Inner` 는 부모(`store.rs`)의 하나를 쓰고(자기 잠금 없음), 사건은 늘 그 잠금 안에서 `after_change` 로 낸다.
//! `store.rs` 에서 그대로 옮겼다.

use serde_json::{json, Value};

use super::*;

impl Orchestration {
    // -----------------------------------------------------------------------
    // 사람 명령(Tauri → 서버 op — `ops.rs`)
    // -----------------------------------------------------------------------

    /// Run 시작(통합 ref 없음 — 1차 동작) — 세대 1(조정자는 이 뒤 GUI Rust 가 조정자 타일을 묶어 정한다 — 3차 4단계부터 조정자 토큰은 없다).
    /// 서버 전체 동시 Run 한도 안에서만. 사람의 시작 op 는 통합 ref 를
    /// 함께 만드는 `start_integrated_run`(`accept.rs`)을 쓴다 — 이 길은 시험 · 통합 없는 Run 용.
    #[cfg(test)]
    pub(crate) fn start_run(&self, s: StartRun) -> Result<(String, u32), OrchError> {
        let id = new_id("run").ok_or_else(no_randomness)?;
        self.start_run_with(s, id, None)
    }

    /// Run 시작 — id 와 통합 ref 칸(있으면 이미 만들어 둔 것)을 받는다.
    #[cfg(test)]
    pub(in crate::orchestration) fn start_run_with(&self, s: StartRun, id: String, integration: Option<Integration>) -> Result<(String, u32), OrchError> {
        self.start_run_core(s, id, integration)
    }

    /// Run 시작의 몸 — `ai` 가 있으면 **AI 가 연 Run**(5단계 `start_run`): 같은 잠금 안에서 시작 빈도(`run-rate-limited`) · 그 타일이 다른 산
    /// Run 의 조정자가 아닌지(`already-coordinating`)를 다시 보고, `origin = ai` · 조정자 묶음 `(gen 1, stream)` · 보드 배치 장부(세대 1)를
    /// 함께 세운다(묶음과 Run 이 한 잠금에서 선다 — 그 사이 다른 요청이 끼지 않게).
    #[cfg(test)]
    pub(in crate::orchestration) fn start_run_core(
        &self,
        s: StartRun,
        id: String,
        integration: Option<Integration>,
    ) -> Result<(String, u32), OrchError> {
        self.start_run_core_with_album(s, id, integration, None)
    }

    /// 사람 앨범은 신원 · 구성 · 조정자 · 귀속을 이 한 잠금에서 함께 세운다.
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
                // 옛 파일 호환 칸(2차 시작 대화) — 새 Run 은 쓰지 않는다(읽은 옛 값은 다시 저장할 때 그대로).
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
                // 옛 파일 호환 칸(2차 붙여넣기 전달 기록) — 새 Run 은 쓰지 않는다.
                deliveries: None,
                commits: Vec::new(),
                log: Vec::new(),
                requests: VecDeque::new(),
                // 통합 ref(시작 op 가 이미 만든 것 — `accept.rs`). 없으면 1차 동작(통합 없음 · 수락 동기).
                integration,
                hold: None,
                jobs: Vec::new(),
                // 수락 전 검증(통합 설계 5절) — 맡기기의 사본(사람만 정한다 — `start.rs`).
                verify: s.verify,
                // 옛 파일 호환 칸(2차 `requireReview` · 검토자 CLI) — 새 Run 은 쓰지 않는다. 수락 규칙은 맡기기(`roles.rs`).
                require_review: None,
                reviewer_clis: None,
                review_reports: Vec::new(),
                temp_pending: Vec::new(),
                delegation: snapshot,
                origin: human.map_or_else(human_origin, |(p, seat)| RunOrigin {
                    by: "human".into(), producer: Some(seat.chat.clone()), producer_config: Some(p.producer.clone()),
                }),
                // 보드 자동 배치(Q3) — AI 가 연 Run 만(사람의 시작 대화는 탭을 직접 연다).
                // 귀속(설계 2-3): 프로듀서 채팅이 연 Run 이면 그 채팅 하나 — 아래 색인과 같은 잠금에서 선다.
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
                // 검증 명령은 길이 · SHA-256 · 자동 실행 여부만(글자는 싣지 않는다 — 통합 설계 7절 감사).
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

    /// 일시정지(사람) — running → paused. 이미 paused 면 아무 일 없음. 작업자는 계속 돈다(조율 쓰기만 막힌다).
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
        // (3a) 도는 턴은 끝까지 둔다 — 일시정지는 새 조율 쓰기 · 새 턴(`send_prompt` · `spawn_worker`)만 막는다.
        self.audit("human_paused", run_id, human_detail(gen, RunState::Paused));
        Ok(())
    }

    /// 재개(사람) — paused → running. 조율 한도가 이미 지났으면 거절(`limit-reached` — 중단 또는 새 Run). **지금 세대의 조정자가 묶여
    /// 있어야** 한다(`no-coordinator` — 조정자 없는 running 은 아무도 조율하지 못하고 `adopt_run` 도 받지 않는다: AI 타일이 이어받거나 중단).
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

    /// 중단(사람) — running/paused → stopping: **즉시** 새 조율 쓰기 · 새 생성을 막고 조정자 묶음을 푼다(그 타일의 늦은 조율은 `run-ended`). 턴이 도는 작업자는 모두
    /// `stopping` 으로 올리고 서버 손이 트리를 끝낸다 — **종료가 확인된 뒤에만** `stopped`(설계 C-7). `idle` 작업자는 곧바로 닫는다(4-5 닫는
    /// 사건 — 산 토큰이 없다). 작업자 토큰은 그 턴의 종료가 확인될 때 거둔다(늦은 보고를 `late` 로 받으려고). 도는 턴이 없으면 곧바로 stopped.
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
            // 커밋 단계 전의 통합 작업은 거두고, 커밋 중인 것은 끝을 기다린다(통합 설계 4-4 — `settle_stopping` 이 센다).
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

    /// (3차 6단계) 사람의 [이어 가기](`continue_run`)는 걷었다 — 조정자 CLI 가 끝나 멈춘 Run 은 다른 AI 타일이 `adopt_run`(`start.rs` — 세대 +1 ·
    /// 곧바로 running)으로 이어받는다. 세대 교체를 시험하는 곳은 [`Self::bump_gen_for_test`](시험 전용 — 제품 길 아님).
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
        // 옛 세대 조정자가 요청한 통합 작업 — 커밋 단계 전이면 거둔다(통합 설계 4-4 "세대 교체" — `adopt_run` 과 같은 규칙).
        super::integrate::abort_cancellable(slot, now, Actor::Server, "generation");
        unbind_coordinator(slot);
        self.after_change(&g, run_id);
        Ok(gen)
    }

    /// 사람의 Task 상태 바꾸기 — 취소(`cancelled`)와 다시 열기(`todo`, 취소 · 반려된 것)만. 수락 · 반려 · 뒤집기는
    /// `human_review`(`report.rs` — 불변 산출물 · 검토 기록을 함께 만든다).
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
                task.conflict = None; // 취소 — 충돌 기록은 뜻을 잃었다(#7a).
            }
            task.version += 1;
            task.updated_at = now;
            let task = task.clone();
            if state == TaskState::Cancelled {
                // 취소 — 활성 검토는 무효화(5단계 · 3-3), 그 Task 의 열린 작업자는 닫는다(3a — 4-5 닫는 사건: `idle` 은 곧바로 · 도는 턴은 멈춤).
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

    /// 시험 손 — 시험 자리([`Seat::test`])의 프로세스가 끝났다([`Self::coordinator_exited_seat`] 그대로).
    #[cfg(test)]
    pub(crate) fn coordinator_exited(&self, chat: &str) -> usize {
        self.coordinator_exited_seat(&Seat::test(chat))
    }

    /// **조정자 프로세스가 끝났다**(설계 2-5): 프로듀서 프로세스가 끝나면 레지스트리가 **토큰을 거둔 뒤 · 채팅 잠금 밖에서** 이것을 부른다.
    /// 묶음은 **정확히 같은 자리**(같은 `(chat, proc)`)만 푼다 — 옛 세대의 늦은 정리는 새 묶음에 닿지 않는다. 묶인 Run 이 지금 세대이고
    /// running 이면 **paused**(`pause_reason: coordinator-exited`) + 사건 `coordinator_exited` + 감사 — 조정자 없이 조율 쓰기가 열려 있지 않게
    /// (작업자는 계속 돈다 — 일시정지와 같다). 이미 paused(사람 · 보류 · 조율 한도)였으면 상태 · 까닭은 그대로 두고 같은 사건 · 알림 · 감사만
    /// 낸다 — 화면이 "조정자 없음" 을 알고 사람이 [재개] 대신 이어받기를 기다리게. 묶음 해제가 그 자리의 `wait_run` 을 취소하고 잠정 커서를
    /// 되돌린다(`unbind_coordinator`). 사건을 낸 Run 수.
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
                // 이미 멈춘 앨범(사람 · 보류 · 조율 한도)이면 알림 상세 `already-paused` — 화면이 "멈췄습니다" 대신 "이미 멈춰 있었다" 로 쓴다(실기 10-29).
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

    /// 서버 시계(5초마다 — `server::ai::AiPlane::start_timers`) — 조율 한도가 지난 running 은 paused, 실행 한도가 지난
    /// running/paused 는 stopping(토큰 거둠). 바뀐 Run 수.
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
                // 검증 사람 확인 대기 시한(4단계 — 30분이면 `approval-expired`, Task 는 reported).
                let expired = super::verify::approval_timeouts(slot, now);
                for a in &expired {
                    self.raise(slot, "verify-failed", Some(a), Some(reason::APPROVAL_EXPIRED));
                }
                if !expired.is_empty() {
                    changed.push(id.clone());
                }
                // 종료 미확인 검증 트리 재확인(리뷰 F8) — 확인되면 내려놓고, 그것만 기다리던 중단을 마저 끝낸다.
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
        // 무효화된 검토자의 남은 멈춤(5단계 — 부른 쪽이 놓쳤어도 여기서 맡긴다).
        let queued: Vec<String> = self.lock().runs.keys().cloned().collect();
        for id in queued {
            self.drain_stops(&id);
        }
        // 정리(통합 설계 6-2 — `cleanup.rs`): ref 회수(candidate · conflict) · 끝난 Run 과 orphaned 의 서버 임시 자리 폐기. git · 디스크라
        // 따로 스레드에서(자기 참조가 없으면 — 시험 — 이 자리에서).
        self.cleanup_tick();
        // 결과를 모르는 올리기의 재판정(리뷰 F7 — 남긴 것이 있을 때만 git).
        self.recheck_unknown_commits();
        changed.len()
    }

    /// 잠금 안에서 멈추기로 한 Attempt(무효화된 검토자 — [`Slot::stop_queue`])를 서버 손에 맡긴다. **잠금 밖에서** 부른다.
    pub(in crate::orchestration) fn drain_stops(&self, run_id: &str) {
        let ids: Vec<String> = match self.lock().runs.get_mut(run_id) {
            Some(slot) => std::mem::take(&mut slot.stop_queue),
            None => return,
        };
        self.stop_processes(run_id, &ids);
    }
}
