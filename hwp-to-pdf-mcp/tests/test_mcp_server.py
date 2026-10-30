#!/usr/bin/env python3
"""End-to-end test suite for the hwp-to-pdf-mcp stdio server."""

import json
import subprocess
import sys
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parent.parent
SERVER_SCRIPT = PROJECT_ROOT / "server.py"
TESTS_DIR = PROJECT_ROOT / "tests"


def send_rpc(proc: subprocess.Popen, msg: dict) -> dict:
    assert proc.stdin is not None and proc.stdout is not None
    proc.stdin.write(json.dumps(msg) + "\n")
    proc.stdin.flush()
    if "id" not in msg:
        return {}
    line = proc.stdout.readline()
    if not line:
        stderr_out = proc.stderr.read() if proc.stderr else ""
        raise RuntimeError(f"Server closed stdout unexpectedly. Stderr: {stderr_out}")
    return json.loads(line)


def main() -> None:
    proc = subprocess.Popen(
        [sys.executable, str(SERVER_SCRIPT)],
        stdin=subprocess.PIPE,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
    )

    try:
        # 1. Initialize
        init_res = send_rpc(
            proc,
            {
                "jsonrpc": "2.0",
                "id": 1,
                "method": "initialize",
                "params": {
                    "protocolVersion": "2024-11-05",
                    "capabilities": {},
                    "clientInfo": {"name": "test-client", "version": "1.0.0"},
                },
            },
        )
        assert init_res["result"]["serverInfo"]["name"] == "hwp-to-pdf-mcp", init_res
        send_rpc(proc, {"jsonrpc": "2.0", "method": "notifications/initialized"})

        # 2. List tools
        tools_res = send_rpc(proc, {"jsonrpc": "2.0", "id": 2, "method": "tools/list"})
        tool_names = [t["name"] for t in tools_res["result"]["tools"]]
        assert "convert_hwp_to_pdf" in tool_names, tool_names
        assert "batch_convert_hwp_to_pdf" in tool_names, tool_names
        assert "get_hwp_document_info" in tool_names, tool_names
        print("[OK] tools/list:", tool_names)

        # 3. Inspect .hwp info
        hwp_sample = TESTS_DIR / "sample_korean.hwp"
        hwpx_sample = TESTS_DIR / "sample_report.hwpx"

        info_res = send_rpc(
            proc,
            {
                "jsonrpc": "2.0",
                "id": 3,
                "method": "tools/call",
                "params": {
                    "name": "get_hwp_document_info",
                    "arguments": {"input_path": str(hwp_sample)},
                },
            },
        )
        assert not info_res["result"]["isError"], info_res
        info_payload = json.loads(info_res["result"]["content"][0]["text"])
        assert info_payload["success"] is True
        assert info_payload["total_pages"] == 1
        print("[OK] get_hwp_document_info (.hwp):", info_payload["pages"])

        # 4. Convert .hwp -> .pdf
        hwp_out = TESTS_DIR / "mcp_out_korean.pdf"
        if hwp_out.exists():
            hwp_out.unlink()
        conv_hwp_res = send_rpc(
            proc,
            {
                "jsonrpc": "2.0",
                "id": 4,
                "method": "tools/call",
                "params": {
                    "name": "convert_hwp_to_pdf",
                    "arguments": {
                        "input_path": str(hwp_sample),
                        "output_path": str(hwp_out),
                        "mode": "vector",
                    },
                },
            },
        )
        assert not conv_hwp_res["result"]["isError"], conv_hwp_res
        conv_hwp_payload = json.loads(conv_hwp_res["result"]["content"][0]["text"])
        assert conv_hwp_payload["success"] is True
        assert hwp_out.exists() and hwp_out.stat().st_size > 1000
        print(f"[OK] convert_hwp_to_pdf (.hwp -> .pdf): {hwp_out.name} ({hwp_out.stat().st_size} bytes)")

        # 5. Convert .hwpx -> .pdf
        hwpx_out = TESTS_DIR / "mcp_out_report.pdf"
        if hwpx_out.exists():
            hwpx_out.unlink()
        conv_hwpx_res = send_rpc(
            proc,
            {
                "jsonrpc": "2.0",
                "id": 5,
                "method": "tools/call",
                "params": {
                    "name": "convert_hwp_to_pdf",
                    "arguments": {
                        "input_path": str(hwpx_sample),
                        "output_path": str(hwpx_out),
                        "mode": "vector",
                    },
                },
            },
        )
        assert not conv_hwpx_res["result"]["isError"], conv_hwpx_res
        conv_hwpx_payload = json.loads(conv_hwpx_res["result"]["content"][0]["text"])
        assert conv_hwpx_payload["success"] is True
        assert hwpx_out.exists() and hwpx_out.stat().st_size > 1000
        print(f"[OK] convert_hwp_to_pdf (.hwpx -> .pdf): {hwpx_out.name} ({hwpx_out.stat().st_size} bytes)")

        # 6. Batch convert directory
        batch_out_dir = TESTS_DIR / "batch_out"
        batch_res = send_rpc(
            proc,
            {
                "jsonrpc": "2.0",
                "id": 6,
                "method": "tools/call",
                "params": {
                    "name": "batch_convert_hwp_to_pdf",
                    "arguments": {
                        "directory": str(TESTS_DIR),
                        "output_dir": str(batch_out_dir),
                        "mode": "vector",
                    },
                },
            },
        )
        assert not batch_res["result"]["isError"], batch_res
        batch_payload = json.loads(batch_res["result"]["content"][0]["text"])
        assert batch_payload["success"] is True
        assert batch_payload["succeeded"] >= 2
        print(f"[OK] batch_convert_hwp_to_pdf: {batch_payload['succeeded']}/{batch_payload['total_files']} files converted")

    finally:
        proc.terminate()
        proc.wait(timeout=5)


if __name__ == "__main__":
    main()
