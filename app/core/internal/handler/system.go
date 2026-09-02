package handler

import (
	"github.com/shirou/gopsutil/v4/cpu"
	"github.com/shirou/gopsutil/v4/disk"
	"github.com/shirou/gopsutil/v4/host"
	"github.com/shirou/gopsutil/v4/load"
	"github.com/shirou/gopsutil/v4/mem"
	"github.com/shirou/gopsutil/v4/process"
	"os"
	"path/filepath"

	"github.com/manifold-space/manifold/app/core/internal/model"
)

func systemCPUPercent() (float64, error) {
	percents, err := cpu.Percent(0, false)
	if err != nil || len(percents) == 0 {
		return 0, err
	}
	return percents[0], nil
}

func systemCPUCores() (int, error) { return cpu.Counts(true) }

func systemMemory() (*mem.VirtualMemoryStat, error) { return mem.VirtualMemory() }

func systemLoad() (*load.AvgStat, error) { return load.Avg() }

func systemDisk(databasePath string) (*disk.UsageStat, error) {
	return disk.Usage(filepath.Dir(databasePath))
}

func systemProcess() (*process.Process, error) {
	return process.NewProcess(int32(os.Getpid()))
}

func systemHost() model.SystemHost {
	status := model.SystemHost{}
	if info, err := host.Info(); err == nil {
		status.Hostname = info.Hostname
		status.OS = info.OS
		status.Platform = info.Platform
		status.KernelArch = info.KernelArch
	}
	return status
}
