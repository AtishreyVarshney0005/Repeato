export async function api(path, options = {}) {
    const response = await fetch(path, {
        ...options,
        credentials: 'same-origin',
        headers: {
            ...(options.body ? { 'Content-Type': 'application/json' } : {}),
            ...options.headers
        }
    });
    if (response.status === 204) return null;
    const result = await response.json().catch(() => ({}));
    if (!response.ok) {
        const error = new Error(result.error || 'The request could not be completed.');
        error.status = response.status;
        throw error;
    }
    return result;
}
