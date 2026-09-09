import threading
from typing import Any

from langchain_core.callbacks import BaseCallbackHandler
from langchain_core.messages import AIMessage
from langchain_core.outputs import LLMResult


class StatsCallbackHandler(BaseCallbackHandler):
    """Callback handler that tracks LLM calls, tool calls, and token usage."""

    def __init__(self) -> None:
        super().__init__()
        self._lock = threading.Lock()
        self.llm_calls = 0
        self.tool_calls = 0
        self.tokens_in = 0
        self.tokens_out = 0
        self._seen_llm_run_ids: set[Any] = set()
        self._usage_counted_run_ids: set[Any] = set()
        self._calls_with_usage = 0

    def on_llm_start(
        self,
        serialized: dict[str, Any],
        prompts: list[str],
        **kwargs: Any,
    ) -> None:
        """Increment LLM call counter when an LLM starts (deduped by run id)."""
        self._count_llm_start(kwargs.get("run_id"))

    def on_chat_model_start(
        self,
        serialized: dict[str, Any],
        messages: list[list[Any]],
        **kwargs: Any,
    ) -> None:
        """Increment LLM call counter when a chat model starts (deduped)."""
        self._count_llm_start(kwargs.get("run_id"))

    def _count_llm_start(self, run_id: Any) -> None:
        with self._lock:
            # LangChain may fire both on_llm_start and on_chat_model_start for the
            # same call; dedupe on run_id when available so one call == one count.
            if run_id is not None:
                if run_id in self._seen_llm_run_ids:
                    return
                self._seen_llm_run_ids.add(run_id)
            self.llm_calls += 1

    def on_llm_end(self, response: LLMResult, **kwargs: Any) -> None:
        """Extract token usage from LLM response."""
        self._add_usage_from_response(response)

    def on_chat_model_end(self, response: LLMResult, **kwargs: Any) -> None:
        """Extract token usage from chat-model responses (same canonical path)."""
        self._add_usage_from_response(response)

    def _add_usage_from_response(self, response: LLMResult) -> None:
        try:
            generation = response.generations[0][0]
        except (IndexError, TypeError):
            return

        usage_metadata = None
        if hasattr(generation, "message"):
            message = generation.message
            if isinstance(message, AIMessage) and hasattr(message, "usage_metadata"):
                usage_metadata = message.usage_metadata

        # Fallback: some providers attach llm_output token usage instead.
        if not usage_metadata and hasattr(response, "llm_output"):
            try:
                output = response.llm_output or {}
                usage = output.get("token_usage") or output.get("usage") or {}
                if usage:
                    usage_metadata = {
                        "input_tokens": usage.get("prompt_tokens", 0),
                        "output_tokens": usage.get("completion_tokens", 0),
                    }
            except Exception:
                pass

    def on_llm_end(self, response: LLMResult, **kwargs: Any) -> None:
        """Extract token usage from LLM response."""
        self._add_usage_from_response(response, kwargs.get("run_id"))

    def on_chat_model_end(self, response: LLMResult, **kwargs: Any) -> None:
        """Extract token usage from chat-model responses (same canonical path)."""
        self._add_usage_from_response(response, kwargs.get("run_id"))

    def _add_usage_from_response(self, response: LLMResult, run_id: Any = None) -> None:
        try:
            generation = response.generations[0][0]
        except (IndexError, TypeError):
            return

        with self._lock:
            # Guard against the same LLM run being reported twice (some
            # LangChain paths fire both on_llm_end and on_chat_model_end).
            if run_id is None:
                # No run id available: fall back to response identity.
                run_id = f"resp:{id(response)}"
            if run_id in self._usage_counted_run_ids:
                return
            self._usage_counted_run_ids.add(run_id)
            counted = True
            try:
                usage_metadata = None
                if hasattr(generation, "message"):
                    message = generation.message
                    if isinstance(message, AIMessage) and hasattr(message, "usage_metadata"):
                        usage_metadata = message.usage_metadata

                # Fallback: some providers attach llm_output token usage instead.
                if not usage_metadata and hasattr(response, "llm_output"):
                    try:
                        output = response.llm_output or {}
                        usage = output.get("token_usage") or output.get("usage") or {}
                        if usage:
                            usage_metadata = {
                                "input_tokens": usage.get("prompt_tokens", 0),
                                "output_tokens": usage.get("completion_tokens", 0),
                            }
                    except Exception:
                        pass

                if usage_metadata:
                    self.tokens_in += usage_metadata.get("input_tokens", 0) or 0
                    self.tokens_out += usage_metadata.get("output_tokens", 0) or 0
                    self._calls_with_usage += 1
                elif not counted:
                    # No provider usage available: caller must label totals as
                    # estimated (see get_stats).
                    self._calls_missing_usage = getattr(self, "_calls_missing_usage", 0) + 1
            except Exception:
                pass

    def on_tool_start(
        self,
        serialized: dict[str, Any],
        input_str: str,
        **kwargs: Any,
    ) -> None:
        """Increment tool call counter when a tool starts."""
        with self._lock:
            self.tool_calls += 1

    def get_stats(self) -> dict[str, Any]:
        """Return current statistics."""
        with self._lock:
            return {
                "llm_calls": self.llm_calls,
                "tool_calls": self.tool_calls,
                "tokens_in": self.tokens_in,
                "tokens_out": self.tokens_out,
                # True when some calls lacked provider usage metadata (estimate).
                "estimated": self._calls_with_usage < self.llm_calls,
            }
