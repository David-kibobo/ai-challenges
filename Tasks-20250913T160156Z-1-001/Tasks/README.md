# Deliverables Folder Structure

This repository contains three finalized Terminal-Bench tasks (easy, medium, hard), one SFT notebook, and full model evaluation logs.

---

## `software-development/`

Contains three task folders:

| Task ID   | Difficulty                                                        | Folder Name |
| --------- | ----------------------------------------------------------------- | ----------- |
| ✅ Hard   | `7b2f8890-a931-4ab6-9161-6d41c289e63c_terminal_bench_fifo_hard`   |             |
| ✅ Medium | `051552bf-21cb-4d6e-985a-435764d87689_terminal_bench_fifo_medium` |             |
| ✅ Easy   | `ea12e283-4f7b-46c7-af40-27f35867841f_terminal_bench_fifo_easy`   |             |

Each task follows the official **Terminal-Bench structure**, with:

```
<task-id>/
├── Dockerfile
├── docker-compose.yaml
├── run-tests.sh
├── solution.sh
├── task.yaml
├── model_run_logs/
├── src/
├── tests/
```

---

## `sft_task/`

Contains the supervised fine-tuning notebook:

- 📓 `terminal_bench_fifo_ultra.ipynb`:
  A full walk-through of the solution in an instructional, step-by-step format with **tool calls and outputs**, designed in **Terminal-Bench agent reasoning style**.

---

## `model_run_logs/`

Inside each task folder, the `model_run_logs/` directory contains:

- ✅ `golden_solution_log/`: verified run logs showing that the golden solution passes.
- ❌ Qwen / Claude logs: to demonstrate which models failed under the task constraints.

---

# Summary Table: Model Pass/Fail Results

| Task Folder          | Difficulty | Qwen 30B | Qwen 235B | Qwen Coder 480B | Claude Sonnet 4 | Notes                  |
| -------------------- | ---------- | -------- | --------- | --------------- | --------------- | ---------------------- |
| `7b2f8890..._hard`   | Hard       | ❌       | ❌        | ❌              | ❌              | All models failed      |
| `051552bf..._medium` | Medium     | ❌       | ❌        | ❌              | —               | All Qwen models failed |
| `ea12e283..._easy`   | Easy       | ✅       | ❌        | ✅              | —               | Mixed results          |

---

# How to Run (Example)

From the root of your Terminal-Bench repo:

```bash
tb run \
  --agent terminus \
  --model-name dashscope/qwen3-30b-a3b-instruct-2507 \
  --task-id terminal_bench_fifo_easy \
  --n-attempts 1
```

Make sure the folder is placed under the `tasks/software-development/` directory of the Terminal-Bench repo.
