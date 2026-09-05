import z from "@deepseek-ai/schemastery";
import { modelSelectionFor } from "@deepseek-ai/dsh-agent";
import { z as z$1 } from "zod";
//#region src/projection.ts
const decisionSchema = z$1.object({
	turn: z$1.number().int().positive(),
	step: z$1.number().int().positive(),
	tier: z$1.enum([
		"luna",
		"terra",
		"sol"
	]),
	selection: z$1.object({
		provider: z$1.string().min(1),
		model: z$1.string().min(1),
		reasoningEffort: z$1.string().min(1).optional()
	}),
	reason: z$1.enum([
		"lightweight",
		"default",
		"complex",
		"high-risk"
	])
});
/** Latest automatic route projected for Host and GUI consumers. */
const modelRoutingDecisionProjection = {
	key: "modelRoutingDecision",
	stateVersion: 1,
	stateSchema: decisionSchema.nullable(),
	init: () => null,
	apply: (state, event) => event.type === "model/routing-decision" ? event.data : state,
	wire: {
		viewSchema: decisionSchema.nullable(),
		view: (state) => state
	}
};
//#endregion
//#region src/router.ts
const HIGH_RISK = new RegExp(["高风险|安全(?:边界|审查|审核)|权限|鉴权|认证|隐私|密钥|支付|生产发布|数据迁移|破坏性|删库", "security|authentication|authorization|privacy|secret|payment|production|migration"].join("|"), "iu");
const COMPLEX = new RegExp(["架构|复杂|大型代码库|跨模块|并发|死锁|根因|深度研究", "architecture|complex|large codebase|cross-module|concurren|deadlock|root cause|deep research"].join("|"), "iu");
const LIGHTWEIGHT = new RegExp(["分类|抽取|摘要|总结|格式化|批处理|翻译|改写|重命名|简单|后台轻任务", "classif|extract|summari|format|batch|translat|rewrite|rename|simple"].join("|"), "iu");
/** Whether the proposed step contains human-authored text to classify. */
function hasUserTask(messages) {
	return messages.some((message) => message.source.kind === "user" && message.content.some((block) => block.type === "text" && block.text.trim().length > 0));
}
/**
* Select one configured tier from human-authored text in the proposed step.
* @param messages - claimed messages before prompt assembly.
* @param routes - exact deployment route for every tier.
* @returns the selected tier, route, and stable reason.
*/
function routeAgentStep(messages, routes) {
	const task = messages.filter((message) => message.source.kind === "user").flatMap((message) => message.content).filter((block) => block.type === "text").map((block) => block.text).join("\n");
	if (HIGH_RISK.test(task)) return {
		tier: "sol",
		selection: routes.sol,
		reason: "high-risk"
	};
	if (COMPLEX.test(task)) return {
		tier: "sol",
		selection: routes.sol,
		reason: "complex"
	};
	if (LIGHTWEIGHT.test(task)) return {
		tier: "luna",
		selection: routes.luna,
		reason: "lightweight"
	};
	return {
		tier: "terra",
		selection: routes.terra,
		reason: "default"
	};
}
//#endregion
//#region src/index.ts
const name = "agent-step-model-router";
const inject = ["sessionProjections"];
const routeSchema = z.object({
	provider: z.string().min(1).required(),
	model: z.string().min(1).required()
});
/** Loader schema for the three exact deployment routes. */
const Config = z.object({
	luna: routeSchema.required(),
	terra: routeSchema.required(),
	sol: routeSchema.required()
});
function hasPendingExplicitSelection(events) {
	for (let index = events.length - 1; index >= 0; index -= 1) {
		const event = events[index];
		if (event?.type === "model/selection") return true;
		if (event?.type === "request/header") return false;
	}
	return false;
}
/** Install deterministic Agent-step routing before prompt assembly. */
function apply(ctx, config) {
	ctx.sessionProjections.register(modelRoutingDecisionProjection);
	ctx.on("agent/route-step", async ({ agent, turn, step }, next) => {
		const routed = await next();
		if (!hasUserTask(routed.messages) || hasPendingExplicitSelection(agent.session.snapshotEvents())) return routed;
		const selection = modelSelectionFor(agent.ctx);
		if (selection === void 0) return routed;
		const decision = routeAgentStep(routed.messages, config);
		agent.session.append("model/routing-decision", {
			turn,
			step,
			...decision
		});
		selection.current = decision.selection;
		return routed;
	});
}
//#endregion
export { Config, apply, hasUserTask, inject, modelRoutingDecisionProjection, name, routeAgentStep };
