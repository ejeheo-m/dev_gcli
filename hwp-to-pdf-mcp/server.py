#!/usr/bin/env python3
"""
hwp-to-pdf-mcp: MCP Server for converting Hancom Office .hwp and .hwpx files to .pdf on macOS.

Powered by reverse-engineered headless SimpleEngine (libSimpleEngineLib.dylib) inside
/Applications/Hancom Office HWP.app.
"""

from __future__ import annotations

import json
import os
import subprocess
import sys
import tempfile
from pathlib import Path
from typing import Any, Dict, List, Optional

SERVER_NAME = "hwp-to-pdf-mcp"
SERVER_VERSION = "1.0.0"
DEFAULT_PROTOCOL_VERSION = "2024-11-05"

PROJECT_ROOT = Path(__file__).resolve().parent
CLI_BINARY = PROJECT_ROOT / "bin" / "hwp2pdf_cli"
CLI_SOURCE = PROJECT_ROOT / "src" / "hwp2pdf_cli.mm"
DEFAULT_APP_BUNDLE = "/Applications/Hancom Office HWP.app"

SUPPORTED_EXTENSIONS = {".hwp", ".hwpx", ".hwt", ".hwtx"}


def ensure_cli_binary() -> Path:
    """Ensure the native hwp2pdf_cli binary exists, compiling it if needed."""
    if CLI_BINARY.exists() and os.access(CLI_BINARY, os.X_OK):
        return CLI_BINARY

    if not CLI_SOURCE.exists():
        raise FileNotFoundError(f"Native CLI source not found at {CLI_SOURCE}")

    CLI_BINARY.parent.mkdir(parents=True, exist_ok=True)
    cmd = [
        "clang++",
        "-std=c++17",
        "-O2",
        "-fobjc-arc",
        "-framework",
        "Foundation",
        "-framework",
        "AppKit",
        "-framework",
        "CoreGraphics",
        "-framework",
        "CoreText",
        "-Wl,-rpath,/Applications/Hancom Office HWP.app/Contents/Frameworks/Hnc/Bin",
        "-Wl,-rpath,/Applications/Hancom Office HWP.app/Contents/PlugIns/HwpQLExtPreview.appex/Contents/Frameworks",
        "-Wl,-rpath,/Applications/Hancom Office HWP.app/Contents/Frameworks",
        str(CLI_SOURCE),
        "-o",
        str(CLI_BINARY),
    ]
    proc = subprocess.run(cmd, capture_output=True, text=True, check=False)
    if proc.returncode != 0:
        raise RuntimeError(
            f"Failed to compile hwp2pdf_cli (exit {proc.returncode}): {proc.stderr.strip()}"
        )
    return CLI_BINARY


def run_cli(
    input_path: Path,
    output_path: Optional[Path] = None,
    info_only: bool = False,
    mode: str = "bitmap",
    dpi: float = 300.0,
    start_page: Optional[int] = None,
    end_page: Optional[int] = None,
    app_bundle: str = DEFAULT_APP_BUNDLE,
) -> Dict[str, Any]:
    """Execute the native hwp2pdf_cli binary and parse its JSON response."""
    cli = ensure_cli_binary()
    args: List[str] = [str(cli), "--input", str(input_path)]

    if info_only:
        args.append("--info-only")
    elif output_path is not None:
        args.extend(["--output", str(output_path)])

    if mode in ("vector", "bitmap"):
        args.extend(["--mode", mode])
    else:
        raise ValueError(f"Invalid mode '{mode}'. Expected 'vector' or 'bitmap'.")

    if dpi is not None:
        args.extend(["--dpi", str(float(dpi))])

    if start_page is not None:
        args.extend(["--start-page", str(int(start_page))])

    if end_page is not None:
        args.extend(["--end-page", str(int(end_page))])

    if app_bundle:
        args.extend(["--app-bundle", app_bundle])

    # Double-barrier isolation: run with a dedicated temporary directory so that
    # Hancom engine never touches the user's system $TMPDIR.
    with tempfile.TemporaryDirectory(prefix="hwp2pdf_safe_tmp_") as isolated_tmp:
        env = os.environ.copy()
        env["TMPDIR"] = isolated_tmp + "/"
        proc = subprocess.run(args, capture_output=True, text=True, check=False, env=env)

    stdout_str = proc.stdout.strip()

    if stdout_str:
        last_line = stdout_str.splitlines()[-1]
        try:
            data = json.loads(last_line)
            if proc.returncode != 0 and data.get("success") is not False:
                data["success"] = False
                data["exit_code"] = proc.returncode
            return data
        except json.JSONDecodeError:
            pass

    return {
        "success": False,
        "error": proc.stderr.strip() or stdout_str or f"hwp2pdf_cli exited with code {proc.returncode}",
        "exit_code": proc.returncode,
    }


def handle_convert_hwp_to_pdf(arguments: Dict[str, Any]) -> Dict[str, Any]:
    raw_input = arguments.get("input_path")
    if not raw_input or not isinstance(raw_input, str):
        raise ValueError("'input_path' is required and must be a string.")

    input_path = Path(raw_input).expanduser().resolve()
    if not input_path.exists():
        raise FileNotFoundError(f"Input file not found: {input_path}")
    if input_path.suffix.lower() not in SUPPORTED_EXTENSIONS:
        raise ValueError(
            f"Unsupported file extension '{input_path.suffix}'. Supported extensions: {sorted(SUPPORTED_EXTENSIONS)}"
        )

    raw_output = arguments.get("output_path")
    if raw_output:
        output_path = Path(str(raw_output)).expanduser().resolve()
    else:
        output_path = input_path.with_suffix(".pdf")

    mode = str(arguments.get("mode", "bitmap")).lower()
    dpi = float(arguments.get("dpi", 300.0))
    start_page = arguments.get("start_page")
    end_page = arguments.get("end_page")

    result = run_cli(
        input_path=input_path,
        output_path=output_path,
        info_only=False,
        mode=mode,
        dpi=dpi,
        start_page=int(start_page) if start_page is not None else None,
        end_page=int(end_page) if end_page is not None else None,
    )
    if result.get("success") and output_path.exists():
        result["output_file_size_bytes"] = output_path.stat().st_size
    return result


def handle_batch_convert_hwp_to_pdf(arguments: Dict[str, Any]) -> Dict[str, Any]:
    input_paths_arg = arguments.get("input_paths") or []
    directory_arg = arguments.get("directory")
    recursive = bool(arguments.get("recursive", False))
    output_dir_arg = arguments.get("output_dir")
    mode = str(arguments.get("mode", "bitmap")).lower()
    dpi = float(arguments.get("dpi", 300.0))

    discovered_files: List[Path] = []

    for item in input_paths_arg:
        p = Path(str(item)).expanduser().resolve()
        if p.is_dir():
            pattern = "**/*" if recursive else "*"
            for child in sorted(p.glob(pattern)):
                if child.is_file() and child.suffix.lower() in SUPPORTED_EXTENSIONS:
                    discovered_files.append(child)
        elif p.is_file() and p.suffix.lower() in SUPPORTED_EXTENSIONS:
            discovered_files.append(p)

    if directory_arg:
        d = Path(str(directory_arg)).expanduser().resolve()
        if not d.is_dir():
            raise NotADirectoryError(f"Directory not found: {d}")
        pattern = "**/*" if recursive else "*"
        for child in sorted(d.glob(pattern)):
            if child.is_file() and child.suffix.lower() in SUPPORTED_EXTENSIONS:
                discovered_files.append(child)

    # Deduplicate preserving order
    unique_files: List[Path] = []
    seen = set()
    for f in discovered_files:
        if f not in seen:
            seen.add(f)
            unique_files.append(f)

    if not unique_files:
        return {
            "success": False,
            "error": "No .hwp or .hwpx files found in the specified input_paths or directory.",
            "total_files": 0,
            "results": [],
        }

    output_dir: Optional[Path] = None
    if output_dir_arg:
        output_dir = Path(str(output_dir_arg)).expanduser().resolve()
        output_dir.mkdir(parents=True, exist_ok=True)

    results: List[Dict[str, Any]] = []
    succeeded = 0
    failed = 0

    for src in unique_files:
        if output_dir is not None:
            dst = output_dir / f"{src.stem}.pdf"
        else:
            dst = src.with_suffix(".pdf")

        res = run_cli(
            input_path=src,
            output_path=dst,
            info_only=False,
            mode=mode,
            dpi=dpi,
        )
        if res.get("success") and dst.exists():
            res["output_file_size_bytes"] = dst.stat().st_size
            succeeded += 1
        else:
            failed += 1
        results.append(res)

    return {
        "success": failed == 0,
        "total_files": len(unique_files),
        "succeeded": succeeded,
        "failed": failed,
        "results": results,
    }


def handle_get_hwp_document_info(arguments: Dict[str, Any]) -> Dict[str, Any]:
    raw_input = arguments.get("input_path")
    if not raw_input or not isinstance(raw_input, str):
        raise ValueError("'input_path' is required and must be a string.")

    input_path = Path(raw_input).expanduser().resolve()
    if not input_path.exists():
        raise FileNotFoundError(f"Input file not found: {input_path}")

    result = run_cli(input_path=input_path, info_only=True)
    if result.get("success"):
        result["input_file_size_bytes"] = input_path.stat().st_size
        result["format"] = input_path.suffix.lower().lstrip(".")
    return result


TOOLS: List[Dict[str, Any]] = [
    {
        "name": "convert_hwp_to_pdf",
        "description": (
            "Convert a Hancom Office .hwp or .hwpx (or .hwt/.hwtx) document to a .pdf file on macOS "
            "using Hancom Office HWP's native headless SimpleEngine (libSimpleEngineLib.dylib). "
            "By default ('bitmap' mode at 300 DPI), outputs an ultra-sharp, print-quality PDF matching the original layout."
        ),
        "inputSchema": {
            "type": "object",
            "properties": {
                "input_path": {
                    "type": "string",
                    "description": "Path to the source .hwp or .hwpx file.",
                },
                "output_path": {
                    "type": "string",
                    "description": "Optional destination .pdf path. Defaults to <input_path_stem>.pdf.",
                },
                "mode": {
                    "type": "string",
                    "enum": ["bitmap", "vector"],
                    "default": "bitmap",
                    "description": (
                        "Rendering mode: 'bitmap' (default: 300 DPI high-res print quality) preserves exact font visual appearance; "
                        "'vector' draws directly into CGPDFContext for searchable text."
                    ),
                },
                "dpi": {
                    "type": "number",
                    "default": 300,
                    "description": "Rasterization DPI when mode is 'bitmap' (48 to 600, default 300).",
                },
                "start_page": {
                    "type": "integer",
                    "minimum": 1,
                    "description": "Optional 1-based start page number (default: 1).",
                },
                "end_page": {
                    "type": "integer",
                    "minimum": 1,
                    "description": "Optional 1-based inclusive end page number (default: last page).",
                },
            },
            "required": ["input_path"],
        },
    },
    {
        "name": "batch_convert_hwp_to_pdf",
        "description": (
            "Batch convert multiple .hwp and .hwpx files (or all .hwp/.hwpx files in a directory) to .pdf."
        ),
        "inputSchema": {
            "type": "object",
            "properties": {
                "input_paths": {
                    "type": "array",
                    "items": {"type": "string"},
                    "description": "List of .hwp/.hwpx file paths or directory paths to convert.",
                },
                "directory": {
                    "type": "string",
                    "description": "Directory path to scan for .hwp and .hwpx files.",
                },
                "recursive": {
                    "type": "boolean",
                    "default": False,
                    "description": "Recursively scan subdirectories for .hwp and .hwpx files.",
                },
                "output_dir": {
                    "type": "string",
                    "description": "Optional directory where converted .pdf files should be written.",
                },
                "mode": {
                    "type": "string",
                    "enum": ["bitmap", "vector"],
                    "default": "bitmap",
                    "description": "Rendering mode: 'bitmap' (default: 300 DPI) or 'vector'.",
                },
                "dpi": {
                    "type": "number",
                    "default": 300,
                    "description": "Rasterization DPI when mode is 'bitmap' (default 300).",
                },
            },
        },
    },
    {
        "name": "get_hwp_document_info",
        "description": (
            "Get page count and exact page dimensions (in points and millimeters) of a .hwp or .hwpx file "
            "without rendering a PDF."
        ),
        "inputSchema": {
            "type": "object",
            "properties": {
                "input_path": {
                    "type": "string",
                    "description": "Path to the .hwp or .hwpx file to inspect.",
                },
            },
            "required": ["input_path"],
        },
    },
]


def send_response(msg: Dict[str, Any]) -> None:
    sys.stdout.write(json.dumps(msg, ensure_ascii=False) + "\n")
    sys.stdout.flush()


def handle_request(request: Dict[str, Any]) -> None:
    method = request.get("method")
    req_id = request.get("id")
    params = request.get("params") or {}

    # Notifications have no 'id' and expect no response
    if req_id is None:
        return

    try:
        if method == "initialize":
            client_version = params.get("protocolVersion", DEFAULT_PROTOCOL_VERSION)
            send_response(
                {
                    "jsonrpc": "2.0",
                    "id": req_id,
                    "result": {
                        "protocolVersion": client_version,
                        "capabilities": {
                            "tools": {"listChanged": False},
                        },
                        "serverInfo": {
                            "name": SERVER_NAME,
                            "version": SERVER_VERSION,
                        },
                    },
                }
            )
        elif method == "ping":
            send_response({"jsonrpc": "2.0", "id": req_id, "result": {}})
        elif method == "tools/list":
            send_response({"jsonrpc": "2.0", "id": req_id, "result": {"tools": TOOLS}})
        elif method == "resources/list":
            send_response({"jsonrpc": "2.0", "id": req_id, "result": {"resources": []}})
        elif method == "prompts/list":
            send_response({"jsonrpc": "2.0", "id": req_id, "result": {"prompts": []}})
        elif method == "tools/call":
            tool_name = params.get("name")
            arguments = params.get("arguments") or {}

            if tool_name == "convert_hwp_to_pdf":
                payload = handle_convert_hwp_to_pdf(arguments)
            elif tool_name == "batch_convert_hwp_to_pdf":
                payload = handle_batch_convert_hwp_to_pdf(arguments)
            elif tool_name == "get_hwp_document_info":
                payload = handle_get_hwp_document_info(arguments)
            else:
                send_response(
                    {
                        "jsonrpc": "2.0",
                        "id": req_id,
                        "error": {"code": -32601, "message": f"Unknown tool: {tool_name}"},
                    }
                )
                return

            is_error = not bool(payload.get("success", False))
            send_response(
                {
                    "jsonrpc": "2.0",
                    "id": req_id,
                    "result": {
                        "content": [
                            {
                                "type": "text",
                                "text": json.dumps(payload, indent=2, ensure_ascii=False),
                            }
                        ],
                        "isError": is_error,
                    },
                }
            )
        else:
            send_response(
                {
                    "jsonrpc": "2.0",
                    "id": req_id,
                    "error": {"code": -32601, "message": f"Method not found: {method}"},
                }
            )
    except Exception as exc:
        send_response(
            {
                "jsonrpc": "2.0",
                "id": req_id,
                "result": {
                    "content": [
                        {
                            "type": "text",
                            "text": json.dumps(
                                {"success": False, "error": str(exc)},
                                indent=2,
                                ensure_ascii=False,
                            ),
                        }
                    ],
                    "isError": True,
                },
            }
        )


def main() -> None:
    for raw_line in sys.stdin:
        line = raw_line.strip()
        if not line:
            continue
        try:
            message = json.loads(line)
        except json.JSONDecodeError as exc:
            send_response(
                {
                    "jsonrpc": "2.0",
                    "id": None,
                    "error": {"code": -32700, "message": f"Parse error: {exc}"},
                }
            )
            continue

        if isinstance(message, dict):
            handle_request(message)


if __name__ == "__main__":
    main()
