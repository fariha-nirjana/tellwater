"""The Glimmer client puts a round 2 adapter's reasoning back into the conversation, and only there."""

import json

import pytest

pytest.importorskip("training")


def _client(adapter, replies):
    from training.renderer.tokenizer import get_tokenizer
    from training.utils.supervised import build_renderer

    from agent.glimmer import REASONING_ADAPTERS, TOKENIZER_MODEL, GlimmerClient, GlimmerEndpoint

    try:
        tok = get_tokenizer(TOKENIZER_MODEL)
    except Exception:
        pytest.skip("Muse Glimmer tokenizer not available")
    from fireworks.training import sdk

    c = object.__new__(GlimmerClient)
    c._sdk = sdk
    c.tokenizer, c.renderer = tok, build_renderer(tok, TOKENIZER_MODEL, "muse_glimmer")
    c.model_path, c.max_tokens, c.modal = adapter, 64, True
    c.keep_reasoning = adapter.startswith(REASONING_ADAPTERS)
    c._reasoning, c.prompts = {}, []
    c.endpoint = GlimmerEndpoint("muse-glimmer-distilled", "muse-glimmer-30b-modal")

    class Remote:
        def remote(self, tokens, blobs, *_):
            c.prompts.append(tok.decode(tokens))
            return {"tokens": tok.encode(replies.pop(0), add_special_tokens=False)}

    c.sampler = type("S", (), {"sample": Remote()})()
    return c


TURN = (' to=self<|message|>Read the overview first.<|eom|><|start|>assistant to=get_case_overview<|message|>'
        '<atem:function_calls>\n<atem:invoke name="get_case_overview">\n<atem:parameter name="why">start</atem:parameter>\n'
        '</atem:invoke>\n</atem:function_calls><|eot|>')


def _two_turns(adapter):
    from agent.tools import TOOL_SPECS

    c = _client(adapter, [TURN, TURN])
    messages = [{"role": "system", "content": "SYS"}, {"role": "user", "content": "Case X"}]
    reply = c.chat(messages, TOOL_SPECS)
    tc = reply.message.tool_calls[0]
    messages += [{"role": "assistant", "content": reply.message.content, "tool_calls": [
        {"id": tc.id, "type": "function", "function": {"name": tc.function.name, "arguments": tc.function.arguments}}]},
        {"role": "tool", "tool_call_id": tc.id, "content": json.dumps({"ok": True})}]
    c.chat(messages, TOOL_SPECS)
    return c, tc


def test_round2_adapter_sees_its_earlier_reasoning():
    c, tc = _two_turns("glimmer-reason/epoch2")
    assert tc.function.name == "get_case_overview" and c._reasoning[tc.id] == "Read the overview first."
    assert "to=self<|message|>Read the overview first.<|eom|>" in c.prompts[1]


def test_earlier_adapters_unchanged():
    c, tc = _two_turns("glimmer-gaps/epoch2")
    assert c._reasoning == {} and "to=self" not in c.prompts[1]
    # call ids are never rendered: the parser's own ids give the same prompt
    from agent.tools import TOOL_SPECS
    from training.utils.supervised import build_tool_prefixed_messages

    def prompt(call_id):
        msgs = [{"role": "system", "content": "SYS"}, {"role": "user", "content": "Case X"},
                {"role": "assistant", "content": "", "tool_calls": [
                    {"id": call_id, "type": "function", "function": {"name": "get_case_overview", "arguments": {"why": "start"}}}]},
                {"role": "tool", "tool_call_id": call_id, "content": json.dumps({"ok": True})}]
        p = c.renderer.build_generation_prompt(build_tool_prefixed_messages(msgs, renderer=c.renderer, tools=TOOL_SPECS))
        return [t for ch in p.chunks for t in ch.tokens]

    assert prompt("get_case_overview:0") == prompt(tc.id)
