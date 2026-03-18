package infra

// linearRegression computes OLS (slope, intercept) for the given xs, ys slices.
// xs are typically Unix timestamps, ys are metric values (e.g. percent utilization).
func linearRegression(xs, ys []float64) (slope, intercept float64) {
	n := float64(len(xs))
	if n < 2 {
		return 0, 0
	}

	var sumX, sumY, sumXY, sumX2 float64
	for i := range xs {
		sumX += xs[i]
		sumY += ys[i]
		sumXY += xs[i] * ys[i]
		sumX2 += xs[i] * xs[i]
	}

	denom := n*sumX2 - sumX*sumX
	if denom == 0 {
		return 0, sumY / n
	}
	slope = (n*sumXY - sumX*sumY) / denom
	intercept = (sumY - slope*sumX) / n
	return slope, intercept
}

// TimeToSaturation returns the number of seconds from now until the trend reaches
// threshold (e.g. 90.0 for 90%). Returns -1 if the trend is flat/declining or if
// the series is already at or above threshold.
//
// xs are Unix timestamps (seconds), ys are percentage values (0–100).
func TimeToSaturation(xs, ys []float64, threshold float64) float64 {
	if len(xs) < 2 {
		return -1
	}
	slope, intercept := linearRegression(xs, ys)
	if slope <= 0 {
		return -1
	}

	now := xs[len(xs)-1]
	currentVal := slope*now + intercept
	if currentVal >= threshold {
		return 0 // already saturated
	}

	// Solve threshold = slope * t + intercept → t = (threshold − intercept) / slope
	t := (threshold - intercept) / slope
	remaining := t - now
	if remaining < 0 {
		return -1
	}
	return remaining
}
